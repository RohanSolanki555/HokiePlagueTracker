import type { Page } from "@playwright/test"

export const user = {
    id: "test-user", aud: "authenticated", role: "authenticated", email: "student@vt.edu",
    email_confirmed_at: "2026-09-19T12:00:00Z", created_at: "2026-09-19T12:00:00Z",
    app_metadata: { password_setup_complete: true }, user_metadata: {},
}

export async function mockSignedIn(page: Page, sessionUser = user) {
    await page.addInitScript((user) => {
        localStorage.setItem("sb-auth-test-auth-token", JSON.stringify({
            access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer",
            expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user,
        }))
    }, sessionUser)
}
