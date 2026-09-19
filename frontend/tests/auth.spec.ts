import { test, expect } from "@playwright/test"
import { mockSignedIn, user } from "./auth-helper"

test("report requires login and signup rejects non-VT email", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Submit report" })).toHaveCount(0)
    await page.getByRole("link", { name: "Create account" }).click()
    await page.getByLabel("Virginia Tech email").fill("student@example.com")
    await page.getByRole("button", { name: "Verify email" }).click()
    await expect(page.getByRole("alert")).toContainText("@vt.edu")
})

test("VT signup sends a magic link with the confirmation redirect", async ({ page }) => {
    let sent = false
    await page.route("https://auth-test.supabase.co/auth/v1/otp**", async route => {
        expect(route.request().postDataJSON().email).toBe("student@vt.edu")
        expect(new URL(route.request().url()).searchParams.get("redirect_to")).toContain("/auth/verify")
        sent = true
        await route.fulfill({ json: {} })
    })
    await page.goto("/signup")
    await page.getByLabel("Virginia Tech email").fill("STUDENT@vt.edu")
    await page.getByRole("button", { name: "Verify email" }).click()
    await expect(page.getByRole("status")).toContainText("Check student@vt.edu")
    expect(sent).toBe(true)
})

test("forgot password sends a reset link with the confirmation redirect", async ({ page }) => {
    let sent = false
    await page.route("https://auth-test.supabase.co/auth/v1/recover**", async route => {
        expect(route.request().postDataJSON().email).toBe("student@vt.edu")
        expect(new URL(route.request().url()).searchParams.get("redirect_to")).toContain("/auth/recovery")
        sent = true
        await route.fulfill({ json: {} })
    })
    await page.goto("/forgot-password")
    await page.getByLabel("Virginia Tech email").fill("STUDENT@vt.edu")
    await page.getByRole("button", { name: "Send reset link" }).click()
    await expect(page.getByRole("status")).toContainText("a password reset link has been sent")
    expect(sent).toBe(true)
})

const confirmationFlows = [
    { name: "password recovery", path: "/auth/recovery", type: "recovery", destination: "/auth/reset", newLink: "/forgot-password" },
    { name: "signup verification", path: "/auth/verify", type: "email", destination: "/auth/setup", newLink: "/signup" },
]

test("signed-in users still confirm recovery before the token is consumed", async ({ page }) => {
    await mockSignedIn(page)
    let verificationRequests = 0
    await page.route("https://auth-test.supabase.co/auth/v1/verify**", async route => {
        verificationRequests += 1
        expect(route.request().postDataJSON()).toMatchObject({ token_hash: "recovery-token-hash", type: "recovery" })
        await route.fulfill({ json: {
            access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer",
            expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user,
        } })
    })
    await page.goto("/auth/recovery?token_hash=recovery-token-hash")
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled()
    await expect(page).toHaveURL(/\/auth\/recovery\?token_hash=recovery-token-hash$/)
    await expect(page.getByLabel("Create password")).toHaveCount(0)
    expect(verificationRequests).toBe(0)

    await page.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(page).toHaveURL(/\/auth\/reset$/)
    await expect(page.getByLabel("Create password")).toBeVisible()
    expect(verificationRequests).toBe(1)
})

for (const flow of confirmationFlows) {
    test(`${flow.name} only consumes the token after Continue`, async ({ page }) => {
        const verificationRequests: unknown[] = []
        await page.route("https://auth-test.supabase.co/auth/v1/verify**", async route => {
            verificationRequests.push(route.request().postDataJSON())
            await route.fulfill({ json: {
                access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer",
                expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
                user: { ...user, app_metadata: { password_setup_complete: flow.type === "recovery" } },
            } })
        })

        // Opening or revisiting an email link must be safe for mail scanners.
        await page.goto(`${flow.path}?token_hash=example-token-hash`)
        await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled()
        expect(verificationRequests).toHaveLength(0)
        await page.reload()
        await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled()
        expect(verificationRequests).toHaveLength(0)
        await expect(page.getByLabel("Create password")).toHaveCount(0)

        await page.getByRole("button", { name: "Continue", exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`${flow.destination}$`))
        await expect(page.getByLabel("Create password")).toBeVisible()
        await expect(page.getByLabel("Confirm password")).toBeVisible()
        expect(verificationRequests).toHaveLength(1)
        expect(verificationRequests[0]).toMatchObject({ token_hash: "example-token-hash", type: flow.type })
    })

    test(`${flow.name} with a missing token offers a new link without verification`, async ({ page }) => {
        let verificationRequests = 0
        await page.route("https://auth-test.supabase.co/auth/v1/verify**", async route => {
            verificationRequests += 1
            await route.fulfill({ status: 400, json: { msg: "Missing token" } })
        })
        await page.goto(flow.path)
        const continueButton = page.getByRole("button", { name: "Continue", exact: true })
        if (await continueButton.isEnabled()) await continueButton.click()
        await expect(page.getByRole("alert")).toBeVisible()
        await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", flow.newLink)
        await expect(page.getByLabel("Create password")).toHaveCount(0)
        expect(verificationRequests).toBe(0)
    })

    test(`${flow.name} with an expired token offers a new link`, async ({ page }) => {
        await page.route("https://auth-test.supabase.co/auth/v1/verify**", route => route.fulfill({
            status: 403, json: { error_code: "otp_expired", msg: "Email link is invalid or has expired" },
        }))
        await page.goto(`${flow.path}?token_hash=expired-token-hash`)
        await page.getByRole("button", { name: "Continue", exact: true }).click()
        await expect(page.getByRole("alert")).toContainText("expired")
        await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", flow.newLink)
        await expect(page).toHaveURL(new RegExp(`${flow.path}\\?token_hash=expired-token-hash$`))
        await expect(page.getByLabel("Create password")).toHaveCount(0)
    })
}

test("setup without email verification offers a new link", async ({ page }) => {
    await page.goto("/auth/setup")
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible()
    await expect(page.getByLabel("Create password")).toHaveCount(0)
})

test("verified user must finish password setup and passwords must match", async ({ page }) => {
    await mockSignedIn(page, { ...user, app_metadata: { password_setup_complete: false } })
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Finish setting up your account" })).toBeVisible()
    await page.getByLabel("Create password").fill("example-password")
    await page.getByLabel("Confirm password").fill("different-password")
    await page.getByRole("button", { name: "Save password" }).click()
    await expect(page.getByRole("alert")).toContainText("both passwords match")
})

test("password login errors are shown", async ({ page }) => {
    await page.route("https://auth-test.supabase.co/auth/v1/token**", route => route.fulfill({
        status: 400, json: { error_code: "invalid_credentials", msg: "Invalid login credentials" },
    }))
    await page.goto("/login")
    await page.getByLabel("Virginia Tech email").fill("student@vt.edu")
    await page.getByLabel("Password", { exact: true }).fill("wrong-password")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toContainText("Invalid login credentials")
})
