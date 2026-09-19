import { mockSignedIn } from "./auth-helper"
import { expect, test } from "@playwright/test"
import { mapData, mockData } from "./fixtures"

test("statistics and selection work without a Google key", async ({ page }) => {
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("Map access has not been configured.", { exact: false })).toBeVisible()
    await expect(page.getByText("2 saved locations")).toBeVisible()
    await page.getByRole("button", { name: /Newman Library/ }).click()
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute("href", /37\.2284,-80\.4198/)
    await page.getByLabel("Filter nearby locations").fill("squires")
    await expect(page.getByRole("button", { name: /Newman Library/ })).toHaveCount(0)
    await page.getByRole("button", { name: /Squires Student Center/ }).click()
    await expect(page.getByText("No reports during this period.")).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("dashboard-desktop.png"), fullPage: true })
})

test("coordinates, radius, and period reach the API; reset returns to campus", async ({ page }) => {
    await mockData(page)
    await page.goto("/")
    await page.getByLabel("Latitude", { exact: true }).fill("40.7128")
    await page.getByLabel("Longitude", { exact: true }).fill("-74.006")
    await page.getByLabel("Search radius").selectOption("10")
    await page.getByLabel("Report period").selectOption("30")
    const request = page.waitForRequest((request) => request.url().includes("latitude=40.7128"))
    await page.getByRole("button", { name: "Update map", exact: true }).click()
    const url = new URL((await request).url())
    expect(Object.fromEntries(url.searchParams)).toEqual({ latitude: "40.7128", longitude: "-74.006", radius_km: "10", days: "30" })
    await expect(page.getByText("Reports in 30 days", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Virginia Tech", exact: true }).click()
    await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("37.2296")
    await expect(page.getByLabel("Search radius")).toHaveValue("3")
})

test("failed requests show an error and can recover", async ({ page }) => {
    let failed = true
    await page.route("**/api/locations/map?*", (route) => route.fulfill(failed
        ? { status: 503, json: { error: "Location data is unavailable. Please try again." } }
        : { json: mapData }))
    await page.goto("/")
    await expect(page.getByRole("alert")).toContainText("Location data is unavailable")
    await expect(page.getByText("Data unavailable", { exact: true })).toBeVisible()
    failed = false
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(page.getByText("2 saved locations")).toBeVisible()
})

test("mobile layout fits the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("2 saved locations")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole("button", { name: /Newman Library/ }).click()
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath("dashboard-mobile.png"), fullPage: true })
})


for (const failure of [
    { status: 404, error: "No location found for that address." },
    { status: 502, error: "Google Maps could not look up that pin. Please try again." },
    { status: 503, error: "The report could not be saved. Please try again." },
]) {
    test(`report errors (${failure.status}) preserve fields and counts and allow retry`, async ({ page }) => {
        let failed = true
        let saved = false
        await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: saved ? {
            ...mapData,
            summary: { ...mapData.summary, total_reports: 7, reports_today: 3 },
            locations: [
                { ...mapData.locations[0], stats: { ...mapData.locations[0].stats, total_reports: 7, reports_today: 3 } },
                mapData.locations[1],
            ],
        } : mapData }))
        await page.route("**/api/reports", (route) => {
            expect(route.request().postDataJSON()).toEqual({
                address: "560 Drillfield Dr, Blacksburg, VA", illness: "Flu", flu_type: "A", severity: 4,
            })
            if (failed) return route.fulfill({ status: failure.status, json: { error: failure.error } })
            saved = true
            return route.fulfill({ status: 201, json: {
                report: { id: 101, location_id: 42, severity: 4, created_at: "2026-09-19T12:00:00Z" },
                location: mapData.locations[0],
            } })
        })
        await page.goto("/")
        await expect(page.getByText("2 saved locations")).toBeVisible()
        const total = page.locator('[data-slot="card"]').filter({
            has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports in 7 days$/ }),
        })
        await page.getByLabel("Street address", { exact: true }).fill("560 Drillfield Dr, Blacksburg, VA")
        await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
        await page.getByLabel("Flu type (optional)").selectOption("A")
        await page.getByLabel("Severity", { exact: true }).selectOption("4")
        await page.getByRole("button", { name: "Submit report", exact: true }).click()
        await expect(page.getByRole("alert")).toHaveText(failure.error)
        await expect(page.getByLabel("Street address", { exact: true })).toHaveValue("560 Drillfield Dr, Blacksburg, VA")
        await expect(page.getByLabel("Illness", { exact: true })).toHaveValue("Flu")
        await expect(page.getByLabel("Flu type (optional)")).toHaveValue("A")
        await expect(page.getByLabel("Severity", { exact: true })).toHaveValue("4")
        await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("37.2296")
        await expect(total.getByText("6", { exact: true })).toBeVisible()
        await expect(page.getByRole("button", { name: /Newman Library/ })).toContainText("6 reports")

        failed = false
        await page.getByRole("button", { name: "Submit report", exact: true }).click()
        await expect(page.getByRole("alert")).toHaveCount(0)
        await expect(page.getByRole("status").filter({ hasText: "Your report was saved for Newman Library." })).toBeVisible()
        await expect(page.getByRole("button", { name: /Newman Library/ })).toHaveAttribute("aria-pressed", "true")
        await expect(total.getByText("7", { exact: true })).toBeVisible()
    })
}

test("the report form prevents repeat submissions while saving", async ({ page }) => {
    await mockData(page)
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    let submissions = 0
    await page.route("**/api/reports", async (route) => {
        submissions += 1
        await pending
        await route.fulfill({ status: 503, json: { error: "Please try again." } })
    })
    await page.goto("/")
    await page.getByLabel("Street address", { exact: true }).fill("560 Drillfield Dr, Blacksburg, VA")
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    const request = page.waitForRequest("**/api/reports")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()
    await request
    try {
        await expect(page.getByRole("button", { name: "Submitting..." })).toBeDisabled()
        await expect(page.getByLabel("Street address", { exact: true })).toBeDisabled()
        await expect(page.getByLabel("Illness", { exact: true })).toBeDisabled()
        await expect(page.getByLabel("Severity", { exact: true })).toBeDisabled()
        expect(submissions).toBe(1)
    } finally {
        release()
    }
    await expect(page.getByRole("button", { name: "Submit report", exact: true })).toBeEnabled()
})

test("an illness is required before a report can be sent", async ({ page }) => {
    await mockData(page)
    let submissions = 0
    await page.route("**/api/reports", (route) => {
        submissions += 1
        return route.fulfill({ status: 503, json: { error: "Unexpected submission." } })
    })
    await page.goto("/")
    await page.getByLabel("Street address", { exact: true }).fill("560 Drillfield Dr, Blacksburg, VA")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()
    await expect(page.getByLabel("Illness", { exact: true })).toBeFocused()
    expect(await page.getByLabel("Illness", { exact: true }).evaluate((element) => (element as HTMLSelectElement).validity.valueMissing)).toBe(true)
    expect(submissions).toBe(0)
})

test("the standalone report form resets flu type and links to the reported location", async ({ page }) => {
    await mockData(page)
    await page.route("**/api/reports", (route) => {
        expect(route.request().postDataJSON()).toEqual({
            address: "560 Drillfield Dr, Blacksburg, VA", illness: "Flu", flu_type: "B", severity: 2,
        })
        return route.fulfill({ status: 201, json: {
            report: { id: 101, location_id: 42, severity: 2, created_at: "2026-09-19T12:00:00Z" },
            location: mapData.locations[0],
        } })
    })
    await page.goto("/report")
    await page.getByLabel("Street address", { exact: true }).fill(" 560 Drillfield Dr, Blacksburg, VA ")
    await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
    await page.getByLabel("Flu type (optional)").selectOption("A")
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    await expect(page.getByLabel("Flu type (optional)")).toHaveCount(0)
    await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
    await expect(page.getByLabel("Flu type (optional)")).toHaveValue("")
    await page.getByLabel("Flu type (optional)").selectOption("B")
    await page.getByLabel("Severity", { exact: true }).selectOption("2")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText("Your report was saved for Newman Library.")
    await expect(page.getByLabel("Street address", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("Illness", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("Severity", { exact: true })).toHaveValue("3")
    const link = page.getByRole("link", { name: "View report on map" })
    const target = new URL((await link.getAttribute("href"))!, "http://localhost")
    expect(Object.fromEntries(target.searchParams)).toEqual({ latitude: "37.2284", longitude: "-80.4198", location_id: "42" })
    await link.click()
    await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("37.2284")
    await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue("-80.4198")
    await expect(page.getByRole("button", { name: /Newman Library/ })).toHaveAttribute("aria-pressed", "true")
})
