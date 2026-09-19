import { expect, test } from "@playwright/test"
import { mapData, mockData, mockGoogleMaps } from "./fixtures"

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
