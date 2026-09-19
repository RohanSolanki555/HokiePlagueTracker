import { test, expect } from "@playwright/test"
import { mockSignedIn, user } from "./auth-helper"

test("report requires login and signup rejects non-VT email", async ({ page }) => {
    await page.goto("/report")
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Submit report" })).toHaveCount(0)
    await page.getByRole("link", { name: "Create account" }).click()
    await page.getByLabel("Virginia Tech email").fill("student@example.com")
    await page.getByRole("button", { name: "Verify email" }).click()
    await expect(page.getByRole("alert")).toContainText("@vt.edu")
})

test("VT signup sends a magic link with the setup redirect", async ({ page }) => {
    let sent = false
    await page.route("https://auth-test.supabase.co/auth/v1/otp**", async route => {
        expect(route.request().postDataJSON().email).toBe("student@vt.edu")
        expect(new URL(route.request().url()).searchParams.get("redirect_to")).toContain("/auth/setup")
        sent = true
        await route.fulfill({ json: {} })
    })
    await page.goto("/signup")
    await page.getByLabel("Virginia Tech email").fill("STUDENT@vt.edu")
    await page.getByRole("button", { name: "Verify email" }).click()
    await expect(page.getByRole("status")).toContainText("Check student@vt.edu")
    expect(sent).toBe(true)
})

test("setup without email verification offers a new link", async ({ page }) => {
    await page.goto("/auth/setup")
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible()
    await expect(page.getByLabel("Create password")).toHaveCount(0)
})

test("verified user must finish password setup and passwords must match", async ({ page }) => {
    await mockSignedIn(page, { ...user, app_metadata: { password_setup_complete: false } })
    await page.goto("/report")
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
