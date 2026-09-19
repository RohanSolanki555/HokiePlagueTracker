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

 test.beforeEach(async ({ page }) => { await mockSignedIn(page) })
