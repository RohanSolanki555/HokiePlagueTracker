import { mockSignedIn } from "./auth-helper"
import { expect, test } from "@playwright/test"
import { mapData, mockData, mockGoogleMaps } from "./fixtures"

test.beforeEach(async ({ page }) => { await mockSignedIn(page) })

test("a failed Google script loads once and does not block location data", async ({ page }) => {
    let scripts = 0
    await page.route("https://maps.googleapis.com/maps/api/js?*", (route) => {
        scripts += 1
        return route.abort()
    })
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("Google Maps could not load.", { exact: false })).toBeVisible()
    await expect(page.getByText("2 saved locations")).toBeVisible()
    expect(scripts).toBe(1)
})

test("pins use stored coordinates and select their matching statistics", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    const pin = page.getByRole("button", { name: "Newman Library: 6 reports", exact: true })
    await expect(pin).toHaveAttribute("data-position", JSON.stringify({ lat: 37.2284, lng: -80.4198 }))
    await pin.click()
    await expect(page.getByRole("button", { name: /Newman Library.*km away/ })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toBeVisible()
    await expect(page.locator("test-marker")).toHaveCount(3)
    await page.getByRole("button", { name: "Refresh data" }).click()
    await expect(page.locator("test-marker")).toHaveCount(3)
    expect(errors).toEqual([])
})

test("search this area submits the map center and empty areas remove old pins", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    await expect(page.locator("test-marker")).toHaveCount(3)
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: { ...mapData, locations: [], summary: { ...mapData.summary, total_reports: 0 } } }))
    const request = page.waitForRequest((request) => request.url().includes("/locations/map?"))
    await page.getByRole("button", { name: "Search this area" }).click()
    expect(new URL((await request).url()).searchParams.get("latitude")).toBe("37.2296")
    await expect(page.locator("test-marker")).toHaveCount(1)
    await expect(page.getByText("No saved locations in this area.", { exact: false })).toBeVisible()
})

test("Google authorization failures leave statistics accessible", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    await expect(page.locator("test-marker")).toHaveCount(3)
    await page.evaluate(() => (window as typeof window & { gm_authFailure: () => void }).gm_authFailure())
    await expect(page.getByText("Google Maps could not authorize this map.", { exact: false })).toBeVisible()
    await page.getByRole("button", { name: /Squires Student Center.*km away/ }).click()
    await expect(page.getByText("No reports during this period.")).toBeVisible()
})


test("reports at one address increment its pin and counters and survive reload", async ({ page }) => {
    await mockGoogleMaps(page)
    const location = {
        id: 100, name: "100 Test Lane", location_type: "Other",
        latitude: 37.30, longitude: -80.45, distance_km: 0,
        stats: { ...mapData.locations[1].stats },
    }
    let submissions = 0
    await page.route("**/api/locations/map?*", (route) => {
        const latitude = Number(new URL(route.request().url()).searchParams.get("latitude"))
        const stats = {
            ...location.stats, total_reports: submissions, reports_today: submissions,
            average_severity: submissions ? 3 : null,
            latest_report_at: submissions ? "2026-09-19T12:00:00Z" : null,
        }
        return route.fulfill({
            json: latitude > 37.29
                ? { ...mapData, locations: submissions ? [{ ...location, stats }] : [], summary: stats }
                : mapData,
        })
    })
    await page.route("**/api/reports", (route) => {
        expect(route.request().method()).toBe("POST")
        expect(route.request().postDataJSON()).toEqual({
            address: "100 Test Lane, Blacksburg, VA", illness: "Common cold", severity: 3,
        })
        submissions += 1
        return route.fulfill({ status: 201, json: {
            report: { id: 1000 + submissions, location_id: 100, severity: 3, created_at: "2026-09-19T12:00:00Z" },
            location,
        } })
    })
    await page.goto("/")
    await expect(page.locator("test-marker")).toHaveCount(3)
    await page.getByLabel("Search radius").selectOption("5")
    await page.getByLabel("Report period").selectOption("14")
    await page.getByRole("button", { name: "Update map", exact: true }).click()
    await expect(page.getByText("2 saved locations")).toBeVisible()
    await page.getByLabel("Filter nearby locations").fill("no match")
    await page.getByLabel("Street address", { exact: true }).fill(" 100 Test Lane ")
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")

    const request = page.waitForRequest((request) => request.url().includes("/locations/map?latitude=37.3&longitude=-80.45"))
    await page.getByRole("button", { name: "Submit report", exact: true }).click()
    const params = new URL((await request).url()).searchParams
    expect(params.get("radius_km")).toBe("5")
    expect(params.get("days")).toBe("14")
    await expect(page.getByRole("status").filter({ hasText: "Your report was saved for 100 Test Lane." })).toBeVisible()
    const pin = page.getByRole("button", { name: "100 Test Lane: 1 reports", exact: true })
    await expect(pin).toHaveAttribute("data-position", JSON.stringify({ lat: 37.30, lng: -80.45 }))
    await expect(pin.locator("test-pin")).toHaveText("1")
    await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("37.3")
    await expect(page.getByLabel("Filter nearby locations")).toHaveValue("")
    await expect(page.getByRole("button", { name: /100 Test Lane.*km away/ })).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator("test-marker")).toHaveCount(2)
    const total = page.locator('[data-slot="card"]').filter({
        has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports in 14 days$/ }),
    })
    const today = page.locator('[data-slot="card"]').filter({
        has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports today$/ }),
    })
    await expect(total.getByText("1", { exact: true })).toBeVisible()
    await expect(today.getByText("1", { exact: true })).toBeVisible()

    await page.getByLabel("Street address", { exact: true }).fill("100 Test Lane")
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()
    const updatedPin = page.getByRole("button", { name: "100 Test Lane: 2 reports", exact: true })
    await expect(updatedPin.locator("test-pin")).toHaveText("2")
    await expect(total.getByText("2", { exact: true })).toBeVisible()
    await expect(today.getByText("2", { exact: true })).toBeVisible()
    await expect(page.locator("test-marker")).toHaveCount(2)
    expect(submissions).toBe(2)

    await page.reload()
    await expect(page.getByRole("button", { name: "Update map", exact: true })).toBeVisible()
    await page.getByLabel("Latitude", { exact: true }).fill("37.3")
    await page.getByLabel("Longitude", { exact: true }).fill("-80.45")
    await page.getByRole("button", { name: "Update map", exact: true }).click()
    await expect(updatedPin.locator("test-pin")).toHaveText("2")
    await expect(page.locator("test-marker")).toHaveCount(2)
})

test("reports from other users refresh on focus and every fifteen seconds", async ({ page }) => {
    await page.clock.install()
    await mockGoogleMaps(page)
    let count = 6
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: {
        ...mapData,
        summary: { ...mapData.summary, total_reports: count, reports_today: count - 4 },
        locations: [
            { ...mapData.locations[0], stats: { ...mapData.locations[0].stats, total_reports: count, reports_today: count - 4 } },
            mapData.locations[1],
        ],
    } }))
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Newman Library: 6 reports", exact: true })).toBeVisible()
    await page.getByRole("button", { name: /Newman Library.*km away/ }).click()
    const total = page.locator('[data-slot="card"]').filter({
        has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports in 7 days$/ }),
    })

    count = 7
    const focusRequest = page.waitForRequest("**/api/locations/map?*")
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await focusRequest
    await expect(page.getByRole("button", { name: "Newman Library: 7 reports", exact: true }).locator("test-pin")).toHaveText("7")
    await expect(total.getByText("7", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /Newman Library.*km away/ })).toHaveAttribute("aria-pressed", "true")

    count = 8
    const pollingRequest = page.waitForRequest("**/api/locations/map?*")
    await page.clock.fastForward(15000)
    await pollingRequest
    await expect(page.getByRole("button", { name: "Newman Library: 8 reports", exact: true }).locator("test-pin")).toHaveText("8")
    await expect(total.getByText("8", { exact: true })).toBeVisible()
    await expect(page.locator("test-marker")).toHaveCount(3)
})
