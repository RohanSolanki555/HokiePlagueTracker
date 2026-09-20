import { expect, test, type Page } from "@playwright/test"
import { dormList, illnessSummary, mapData, mockData } from "./fixtures"

const pritchard = (page: Page) => page.getByRole("button", { name: /Pritchard Hall/ })
const dormSelect = (page: Page) => page.getByLabel("Dorm", { exact: true })
const floorSelect = (page: Page) => page.getByLabel("Floor", { exact: true })
const submit = (page: Page) => page.getByRole("button", { name: "Submit report", exact: true })
const citySummary = (page: Page) => page.getByRole("region", { name: "Illness reports in Blacksburg" })
const illnessRow = (page: Page, illness: string) => citySummary(page).getByRole("listitem").filter({ has: page.getByText(illness, { exact: true }) })

async function fillDormReport(page: Page) {
    await dormSelect(page).selectOption({ label: "Pritchard Hall" })
    await floorSelect(page).selectOption({ label: "Floor 3" })
    await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
    await page.getByLabel("Flu type (optional)").selectOption("A")
    await page.getByLabel("Severity", { exact: true }).selectOption("4")
}

test("the city illness summary shows distinct flu types, counts and shares between the hero and map", async ({ page }) => {
    await mockData(page)
    const request = page.waitForRequest("**/api/stats/illnesses?*")
    await page.goto("/")
    expect(Object.fromEntries(new URL((await request).url()).searchParams)).toEqual({ days: "7" })
    await expect(citySummary(page)).toBeVisible()
    await expect(illnessRow(page, "Common cold")).toContainText("4 reports")
    await expect(illnessRow(page, "Common cold")).toContainText("40%")
    await expect(illnessRow(page, "Flu A")).toContainText("3 reports")
    await expect(illnessRow(page, "Flu A")).toContainText("30%")
    await expect(illnessRow(page, "Flu B")).toContainText("2 reports")
    await expect(illnessRow(page, "Flu B")).toContainText("20%")
    await expect(illnessRow(page, "Stomach bug")).toContainText("10%")
    await expect(citySummary(page).getByRole("listitem")).toHaveCount(4)

    const hero = await page.locator(".dash-hero").boundingBox()
    const summary = await citySummary(page).boundingBox()
    const map = await page.locator(".dash-map-card").boundingBox()
    expect(summary!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height)
    expect(summary!.y + summary!.height).toBeLessThanOrEqual(map!.y)
})

test("city illness totals follow the report period and stay independent of the map radius", async ({ page }) => {
    await mockData(page)
    const queries: Record<string, string>[] = []
    let releasePeriod!: () => void
    const pendingPeriod = new Promise<void>((resolve) => { releasePeriod = resolve })
    await page.route("**/api/stats/illnesses?*", async (route) => {
        const params = new URL(route.request().url()).searchParams
        queries.push(Object.fromEntries(params))
        if (params.get("days") === "14") await pendingPeriod
        return route.fulfill({ json: params.get("days") === "14"
            ? { ...illnessSummary, days: 14, total_reports: 2, illnesses: [{ illness: "Flu B", reports: 2 }] }
            : illnessSummary })
    })
    await page.goto("/")
    await expect(illnessRow(page, "Common cold")).toBeVisible()
    await page.getByLabel("Report period").selectOption("14")
    try {
        await expect(citySummary(page)).toHaveAttribute("aria-busy", "true")
        await expect(illnessRow(page, "Common cold")).toHaveCount(0)
    } finally {
        releasePeriod()
    }
    await expect(illnessRow(page, "Flu B")).toContainText("100%")
    await expect(citySummary(page).getByRole("listitem")).toHaveCount(1)
    expect(queries.at(-1)).toEqual({ days: "14" })
    const summaryRequests = queries.length

    const changedMap = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith("/locations/map") && url.searchParams.get("radius_km") === "5"
    })
    await page.getByLabel("Circle radius").selectOption("5")
    await changedMap
    await expect(page.getByText("2 dorms in this area")).toBeVisible()
    await expect(illnessRow(page, "Flu B")).toContainText("100%")
    expect(queries).toHaveLength(summaryRequests)
})

test("city summary failures can retry into an empty state and refresh with new reports", async ({ page }) => {
    await mockData(page)
    let state: "error" | "empty" | "reports" = "error"
    await page.route("**/api/stats/illnesses?*", (route) => route.fulfill(state === "error"
        ? { status: 503, json: { error: "Illness data is unavailable. Please try again." } }
        : { json: state === "empty" ? { ...illnessSummary, total_reports: 0, illnesses: [] } : illnessSummary }))
    await page.goto("/")
    await expect(citySummary(page).getByRole("alert")).toContainText("Illness data is unavailable")
    await expect(citySummary(page).getByText("No illness reports for this period.")).toHaveCount(0)
    await expect(page.getByText("2 dorms in this area")).toBeVisible()

    state = "empty"
    await citySummary(page).getByRole("button", { name: "Retry illness summary" }).click()
    await expect(citySummary(page).getByText("No illness reports for this period.")).toBeVisible()
    await expect(citySummary(page).getByRole("alert")).toHaveCount(0)
    state = "reports"
    await page.getByRole("button", { name: "Refresh data" }).click()
    await expect(illnessRow(page, "Flu A")).toBeVisible()
    await expect(citySummary(page).getByText("No illness reports for this period.")).toHaveCount(0)
})

test("dorm list and statistics work without a Google key", async ({ page }) => {
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("Map access has not been configured.", { exact: false })).toBeVisible()
    await expect(page.getByText("2 dorms in this area")).toBeVisible()
    await expect(page.getByText("Select a dorm from the list or the map", { exact: false })).toBeVisible()

    await pritchard(page).click()
    await expect(pritchard(page)).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /^Pritchard Hall$/ })).toBeVisible()
    for (const name of ["Illnesses reported", "Reports per day", "Reports by floor"]) {
        await expect(page.getByRole("region", { name })).toBeVisible()
    }
    await expect(page.getByRole("region", { name: "Illnesses reported" }).getByText("Flu A")).toBeVisible()
    await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute("href", /37\.2284,-80\.4198/)
    await page.screenshot({ path: test.info().outputPath("dashboard-desktop.png"), fullPage: true })

    await page.getByLabel("Filter dorms").fill("slusher")
    await expect(pritchard(page)).toHaveCount(0)
    await page.getByRole("button", { name: /Slusher Hall/ }).click()
    await expect(page.getByText("No reports during this period.")).toBeVisible()
    await expect(page.getByRole("region", { name: "Illnesses reported" })).toHaveCount(0)
    await page.getByLabel("Filter dorms").fill("nowhere")
    await expect(page.getByText("No dorms match that name.")).toBeVisible()
})

test("the dashboard requests the Drillfield area without exploration controls", async ({ page }) => {
    await mockData(page)
    const request = page.waitForRequest("**/api/locations/map?*")
    await page.goto("/")
    expect(Object.fromEntries(new URL((await request).url()).searchParams)).toEqual({
        latitude: "37.2274294", longitude: "-80.4222303", radius_km: "3", days: "7",
    })
    await expect(page.getByText("Explore an area", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Latitude", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Update map", exact: true })).toHaveCount(0)
    await expect(page.getByText("Reports in 7 days", { exact: true })).toBeVisible()
})

test("failed requests show an error and can recover", async ({ page }) => {
    await mockData(page)
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
    await expect(page.getByText("2 dorms in this area")).toBeVisible()
})

test("a failed dorm list shows an error instead of an empty list", async ({ page }) => {
    await mockData(page)
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ status: 503, json: { error: "Dorm data is unavailable. Please try again." } }))
    await page.goto("/")
    await expect(page.getByRole("alert").filter({ hasText: "Dorm data is unavailable" })).toBeVisible()
    await expect(page.getByText("No dorms have been added yet.")).toHaveCount(0)
})

test("mobile layout fits the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText("2 dorms in this area")).toBeVisible()
    await pritchard(page).click()
    await expect(page.getByRole("region", { name: "Reports per day" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath("dashboard-mobile.png"), fullPage: true })
})

test("the dorm form limits floors to the chosen dorm and switches to an address form", async ({ page }) => {
    await mockData(page)
    await page.goto("/")
    await expect(floorSelect(page)).toBeDisabled()
    await dormSelect(page).selectOption({ label: "Slusher Hall" })
    await expect(floorSelect(page).locator("option")).toHaveCount(5)
    await dormSelect(page).selectOption({ label: "Pritchard Hall" })
    await expect(floorSelect(page)).toHaveValue("")
    await expect(floorSelect(page).locator("option")).toHaveCount(7)
    await expect(page.getByLabel("Street address", { exact: true })).toHaveCount(0)

    await page.getByLabel("Off campus").check()
    await expect(page.getByLabel("Street address", { exact: true })).toBeVisible()
    await expect(dormSelect(page)).toHaveCount(0)
    await page.getByLabel("On-campus dorm").check()
    await expect(dormSelect(page)).toHaveValue("42")
})

test("a dorm report is sent with the dorm and floor, selects the dorm, and updates its count", async ({ page }) => {
    await mockData(page)
    let total = 6
    await page.route("**/api/stats/illnesses?*", (route) => route.fulfill({ json: {
        ...illnessSummary, total_reports: total + 4,
        illnesses: illnessSummary.illnesses.map((row) => row.illness === "Flu A" ? { ...row, reports: total - 3 } : row),
    } }))
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ json: {
        ...dormList,
        dorms: dormList.dorms.map((dorm) => dorm.id === 42 ? { ...dorm, stats: { ...dorm.stats, total_reports: total } } : dorm),
    } }))
    await page.route("**/api/reports", (route) => {
        expect(route.request().postDataJSON()).toEqual({
            residence_type: "dorm", dorm_id: 42, floor: 3, illness: "Flu", flu_type: "A", severity: 4,
        })
        total = 7
        return route.fulfill({ status: 201, json: { report: { id: 101, location_id: 42, severity: 4, created_at: "2026-09-19T12:00:00Z" } } })
    })
    await page.goto("/")
    await expect(pritchard(page)).toContainText("6 reports")
    await expect(illnessRow(page, "Flu A")).toContainText("30%")
    await fillDormReport(page)
    await submit(page).click()
    await expect(page.getByRole("status").filter({ hasText: "Your report was saved for Pritchard Hall." })).toBeVisible()
    await expect(pritchard(page)).toContainText("7 reports")
    await expect(illnessRow(page, "Flu A")).toContainText("4 reports")
    await expect(illnessRow(page, "Flu A")).toContainText("36.4%")
    await expect(pritchard(page)).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByLabel("Illness", { exact: true })).toHaveValue("")
    await expect(dormSelect(page)).toHaveValue("42")
    await expect(floorSelect(page)).toHaveValue("3")
})

test("a home report sends only the address, and never moves the map or selects anything", async ({ page }) => {
    await mockData(page)
    await page.route("**/api/reports", (route) => {
        expect(route.request().postDataJSON()).toEqual({
            residence_type: "home", address: "225 Stanger St, Blacksburg, VA", illness: "Flu", flu_type: "B", severity: 2,
        })
        return route.fulfill({ status: 201, json: { report: { id: 102, location_id: null, severity: 2, created_at: "2026-09-19T12:00:00Z" } } })
    })
    await page.goto("/")
    await page.getByLabel("Off campus").check()
    await expect(page.getByText("Blacksburg, VA", { exact: true })).toBeVisible()
    await page.getByLabel("Street address", { exact: true }).fill(" 225 Stanger St ")
    await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
    await page.getByLabel("Flu type (optional)").selectOption("B")
    await page.getByLabel("Severity", { exact: true }).selectOption("2")
    await submit(page).click()
    await expect(page.getByRole("status").filter({ hasText: "approximate area" })).toBeVisible()
    await expect(page.getByLabel("Street address", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("Circle radius")).toHaveValue("3")
    await expect(page.getByLabel("Report period")).toHaveValue("7")
    for (const dorm of ["Pritchard Hall", "Slusher Hall"]) {
        await expect(page.getByRole("button", { name: new RegExp(dorm) })).toHaveAttribute("aria-pressed", "false")
    }
})

for (const failure of [
    { status: 404, error: "Address not found in Blacksburg, VA" },
    { status: 502, error: "Unable to look up that address. Please try again." },
    { status: 503, error: "Unable to save your report. Please try again later." },
]) {
    test(`report errors (${failure.status}) preserve fields and allow retry`, async ({ page }) => {
        await mockData(page)
        let failed = true
        await page.route("**/api/reports", (route) => failed
            ? route.fulfill({ status: failure.status, json: { error: failure.error } })
            : route.fulfill({ status: 201, json: { report: { id: 103, location_id: null, severity: 4, created_at: "2026-09-19T12:00:00Z" } } }))
        await page.goto("/")
        await page.getByLabel("Off campus").check()
        await page.getByLabel("Street address", { exact: true }).fill("560 Drillfield Dr")
        await page.getByLabel("Illness", { exact: true }).selectOption("Flu")
        await page.getByLabel("Flu type (optional)").selectOption("A")
        await page.getByLabel("Severity", { exact: true }).selectOption("4")
        await submit(page).click()
        await expect(page.getByRole("alert")).toHaveText(failure.error)
        await expect(page.getByLabel("Street address", { exact: true })).toHaveValue("560 Drillfield Dr")
        await expect(page.getByLabel("Illness", { exact: true })).toHaveValue("Flu")
        await expect(page.getByLabel("Flu type (optional)")).toHaveValue("A")
        await expect(page.getByLabel("Severity", { exact: true })).toHaveValue("4")
        failed = false
        await submit(page).click()
        await expect(page.getByRole("alert")).toHaveCount(0)
        await expect(page.getByRole("status").filter({ hasText: "approximate area" })).toBeVisible()
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
    await dormSelect(page).selectOption({ label: "Pritchard Hall" })
    await floorSelect(page).selectOption({ label: "Floor 3" })
    await page.getByLabel("Illness", { exact: true }).selectOption("Common cold")
    const request = page.waitForRequest("**/api/reports")
    await submit(page).click()
    await request
    try {
        await expect(page.getByRole("button", { name: "Submitting..." })).toBeDisabled()
        await expect(dormSelect(page)).toBeDisabled()
        await expect(floorSelect(page)).toBeDisabled()
        await expect(page.getByLabel("Illness", { exact: true })).toBeDisabled()
        expect(submissions).toBe(1)
    } finally {
        release()
    }
    await expect(submit(page)).toBeEnabled()
})

test("a dorm, floor and illness are required before a report can be sent", async ({ page }) => {
    await mockData(page)
    let submissions = 0
    await page.route("**/api/reports", (route) => {
        submissions += 1
        return route.fulfill({ status: 503, json: { error: "Unexpected submission." } })
    })
    await page.goto("/")
    await submit(page).click()
    await expect(dormSelect(page)).toBeFocused()
    expect(await dormSelect(page).evaluate((element) => (element as HTMLSelectElement).validity.valueMissing)).toBe(true)
    await dormSelect(page).selectOption({ label: "Pritchard Hall" })
    await submit(page).click()
    await expect(floorSelect(page)).toBeFocused()
    await floorSelect(page).selectOption({ label: "Floor 3" })
    await submit(page).click()
    await expect(page.getByLabel("Illness", { exact: true })).toBeFocused()
    expect(submissions).toBe(0)
})

test("dorms can be sorted by report count or by name", async ({ page }) => {
    await mockData(page)
    const ashby = { ...dormList.dorms[1], id: 7, name: "Ashby Hall" } // No reports.
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ json: { ...dormList, dorms: [ashby, dormList.dorms[0]] } }))
    await page.goto("/")
    const names = () => page.locator("button[aria-pressed] .dash-dorm-name").allInnerTexts()
    await expect.poll(names).toEqual(["Pritchard Hall", "Ashby Hall"])
    await page.getByLabel("Sort dorms").selectOption("name")
    await expect.poll(names).toEqual(["Ashby Hall", "Pritchard Hall"])
})

test("the live indicator shows how fresh the data is", async ({ page }) => {
    await page.clock.install()
    await mockData(page)
    await page.goto("/")
    await expect(page.getByText(/Live · updated (just now|\d+s ago)/)).toBeVisible()
    await page.clock.fastForward(8000)
    await expect(page.getByText(/Live · updated \d+s ago/)).toBeVisible()
})

test("the live indicator reports a lost connection", async ({ page }) => {
    await mockData(page)
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ status: 503, json: { error: "Location data is unavailable. Please try again." } }))
    await page.goto("/")
    await expect(page.getByText("Connection lost · retrying")).toBeVisible()
})
