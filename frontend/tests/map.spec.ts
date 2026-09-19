import { expect, test, type Page } from "@playwright/test"
import { dormList, mapData, mockData, mockGoogleMaps } from "./fixtures"

const listRow = (page: Page, name: string) => page.locator("button[aria-pressed]", { hasText: name })
const homeMarkers = (page: Page) => page.locator('test-marker[aria-hidden="true"]')
const markers = (page: Page) => page.locator("test-marker")

// Search-centre pin + 2 dorm pins + 1 home area.
const INITIAL_MARKERS = 4

test("a failed Google script loads once and does not block dorm data", async ({ page }) => {
    let scripts = 0
    await page.route("https://maps.googleapis.com/maps/api/js?*", (route) => {
        scripts += 1
        return route.abort()
    })
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("Google Maps could not load.", { exact: false })).toBeVisible()
    await expect(page.getByText("2 dorms in this area")).toBeVisible()
    await expect(listRow(page, "Pritchard Hall")).toBeVisible()
    expect(scripts).toBe(1)
})

test("dorm pins select their dorm; home areas are approximate and cannot be selected", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)

    const pin = page.getByRole("button", { name: "Pritchard Hall: 6 reports", exact: true })
    await expect(pin).toHaveAttribute("data-position", JSON.stringify({ lat: 37.2284, lng: -80.4198 }))
    await expect(pin.locator("test-pin")).toHaveText("6")
    await pin.click()
    await expect(listRow(page, "Pritchard Hall")).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("region", { name: "Reports per day" })).toBeVisible()

    const home = homeMarkers(page)
    await expect(home).toHaveCount(1)
    await expect(home).toHaveAttribute("data-position", JSON.stringify({ lat: 37.2325, lng: -80.4175 }))
    await expect(home).toHaveCSS("pointer-events", "none")
    expect(await home.getAttribute("role")).toBeNull()
    await expect(page.getByRole("button", { name: /home|address|approximate/i })).toHaveCount(0)
    await listRow(page, "Slusher Hall").click()
    await home.dispatchEvent("click")
    await expect(listRow(page, "Slusher Hall")).toHaveAttribute("aria-pressed", "true")
    await expect(listRow(page, "Pritchard Hall")).toHaveAttribute("aria-pressed", "false")

    await page.getByRole("button", { name: "Refresh data" }).click()
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
    expect(errors).toEqual([])
})

test("search this area submits the map center and empty areas remove old pins", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
    await page.route("**/api/locations/map?*", (route) => route.fulfill({
        json: { ...mapData, locations: [], home_areas: [], summary: { ...mapData.summary, total_reports: 0 } },
    }))
    const request = page.waitForRequest((request) => request.url().includes("/locations/map?"))
    await page.getByRole("button", { name: "Search this area" }).click()
    expect(new URL((await request).url()).searchParams.get("latitude")).toBe("37.2296")
    await expect(markers(page)).toHaveCount(1)
    await expect(page.getByText("0 dorms in this area")).toBeVisible()
    await expect(listRow(page, "Pritchard Hall")).toBeVisible() // The dorm list does not depend on the map area.
})

test("Google authorization failures leave statistics accessible", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    await page.goto("/")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
    await page.evaluate(() => (window as typeof window & { gm_authFailure: () => void }).gm_authFailure())
    await expect(page.getByText("Google Maps could not authorize this map.", { exact: false })).toBeVisible()
    await listRow(page, "Slusher Hall").click()
    await expect(page.getByText("No reports during this period.")).toBeVisible()
})

test("a dorm report increments its pin, the totals, and its statistics", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    let total = 6
    const stats = () => ({ ...mapData.summary, total_reports: total, reports_today: total - 4 })
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: {
        ...mapData, summary: stats(),
        locations: [{ ...mapData.locations[0], stats: stats() }, mapData.locations[1]],
    } }))
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ json: {
        ...dormList,
        dorms: dormList.dorms.map((dorm) => dorm.id === 42 ? { ...dorm, stats: stats() } : dorm),
    } }))
    await page.route("**/api/reports", (route) => {
        expect(route.request().postDataJSON()).toEqual({
            residence_type: "dorm", dorm_id: 42, floor: 3, illness: "Common cold", severity: 3,
        })
        total = 7
        return route.fulfill({ status: 201, json: { report: { id: 1001, location_id: 42, severity: 3, created_at: "2026-09-19T12:00:00Z" } } })
    })
    await page.goto("/")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
    await page.getByLabel("Dorm", { exact: true }).selectOption({ label: "Pritchard Hall" })
    await page.getByLabel("Floor", { exact: true }).selectOption({ label: "Floor 3" })
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()

    const updated = page.getByRole("button", { name: "Pritchard Hall: 7 reports", exact: true })
    await expect(updated.locator("test-pin")).toHaveText("7")
    await expect(listRow(page, "Pritchard Hall")).toContainText("7 reports")
    await expect(listRow(page, "Pritchard Hall")).toHaveAttribute("aria-pressed", "true")
    const totalCard = page.locator('[data-slot="card"]').filter({
        has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports in 7 days$/ }),
    }).first()
    await expect(totalCard.getByText("7", { exact: true })).toBeVisible()
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
})

test("a home report adds only an unclickable area, without moving the map or exposing the address", async ({ page }) => {
    await mockGoogleMaps(page)
    await mockData(page)
    let submitted = false
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: {
        ...mapData,
        home_areas: submitted
            ? [...mapData.home_areas, { latitude: 37.2275, longitude: -80.4125, reports: 1 }]
            : mapData.home_areas,
    } }))
    await page.route("**/api/reports", (route) => {
        expect(route.request().postDataJSON()).toEqual({
            residence_type: "home", address: "225 Stanger St, Blacksburg, VA", illness: "Common cold", severity: 3,
        })
        submitted = true
        return route.fulfill({ status: 201, json: { report: { id: 1002, location_id: null, severity: 3, created_at: "2026-09-19T12:00:00Z" } } })
    })
    await page.goto("/")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
    await page.getByLabel("Off campus").check()
    await page.getByLabel("Street address", { exact: true }).fill("225 Stanger St")
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    await page.getByRole("button", { name: "Submit report", exact: true }).click()

    await expect(markers(page)).toHaveCount(INITIAL_MARKERS + 1)
    await expect(homeMarkers(page)).toHaveCount(2)
    await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue("37.2296")
    await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue("-80.4139")
    // The form's placeholder legitimately contains an example address, so check markers and visible text only.
    expect(await markers(page).evaluateAll((elements) => elements.map((element) => element.outerHTML).join(""))).not.toContain("Stanger")
    await expect(page.locator("body")).not.toContainText("Stanger")
    await expect(page.locator("button[aria-pressed=true]")).toHaveCount(0)
})

test("reports from other users refresh on focus and every fifteen seconds", async ({ page }) => {
    await page.clock.install()
    await mockGoogleMaps(page)
    await mockData(page)
    let count = 6
    const stats = () => ({ ...mapData.summary, total_reports: count, reports_today: count - 4 })
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: {
        ...mapData, summary: stats(),
        locations: [{ ...mapData.locations[0], stats: stats() }, mapData.locations[1]],
    } }))
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ json: {
        ...dormList,
        dorms: dormList.dorms.map((dorm) => dorm.id === 42 ? { ...dorm, stats: stats() } : dorm),
    } }))
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Pritchard Hall: 6 reports", exact: true })).toBeVisible()
    await listRow(page, "Pritchard Hall").click()
    const totalCard = page.locator('[data-slot="card"]').filter({
        has: page.locator('[data-slot="card-title"]').filter({ hasText: /^Reports in 7 days$/ }),
    }).first()

    count = 7
    const focusRequest = page.waitForRequest("**/api/locations/map?*")
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await focusRequest
    await expect(page.getByRole("button", { name: "Pritchard Hall: 7 reports", exact: true }).locator("test-pin")).toHaveText("7")
    await expect(listRow(page, "Pritchard Hall")).toContainText("7 reports")
    await expect(totalCard.getByText("7", { exact: true })).toBeVisible()
    await expect(listRow(page, "Pritchard Hall")).toHaveAttribute("aria-pressed", "true")

    count = 8
    const pollingRequest = page.waitForRequest("**/api/locations/map?*")
    await page.clock.fastForward(15000)
    await pollingRequest
    await expect(page.getByRole("button", { name: "Pritchard Hall: 8 reports", exact: true }).locator("test-pin")).toHaveText("8")
    await expect(listRow(page, "Pritchard Hall")).toContainText("8 reports")
    await expect(markers(page)).toHaveCount(INITIAL_MARKERS)
})
