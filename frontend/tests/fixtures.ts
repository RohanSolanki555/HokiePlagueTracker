import type { Page } from "@playwright/test"
import type { DormDetail, DormListResponse, LocationMapResponse, ReportPeriod } from "../src/services/api"
import { mockSignedIn } from "./auth-helper"

const busy = { total_reports: 6, reports_today: 2, previous_period_reports: 3, change_percent: 100, average_severity: 2.5, latest_report_at: "2026-09-19T11:00:00Z" }
const quiet = { total_reports: 0, reports_today: 0, previous_period_reports: 0, change_percent: 0, average_severity: null, latest_report_at: null }

export const mapData: LocationMapResponse = {
    center: { latitude: 37.2274294, longitude: -80.4222303 }, radius_km: 3, days: 7,
    generated_at: "2026-09-19T12:00:00Z", unmapped_locations: 1,
    summary: busy,
    locations: [
        { id: 42, name: "Pritchard Hall", location_type: "Residence", floors: 6, latitude: 37.2284, longitude: -80.4198, distance_km: 0.54, stats: busy },
        { id: 99, name: "Slusher Hall", location_type: "Residence", floors: 4, latitude: 37.2296, longitude: -80.4179, distance_km: 0.35, stats: quiet },
    ],
    home_areas: [{ latitude: 37.2325, longitude: -80.4175, reports: 2 }],
}

export const dormList: DormListResponse = {
    days: 7, generated_at: "2026-09-19T12:00:00Z",
    dorms: [
        { id: 42, name: "Pritchard Hall", floors: 6, latitude: 37.2284, longitude: -80.4198, stats: busy },
        { id: 99, name: "Slusher Hall", floors: 4, latitude: 37.2296, longitude: -80.4179, stats: quiet },
    ],
}

export function dormDetail(id: number, days: ReportPeriod = 7): DormDetail {
    const dorm = dormList.dorms.find((row) => row.id === id)!
    const { stats, ...summary } = dorm
    return {
        dorm: summary, days, generated_at: "2026-09-19T12:00:00Z", stats,
        illnesses: id === 42 ? [{ illness: "Flu A", reports: 4 }, { illness: "Norovirus", reports: 2 }] : [],
        daily: id === 42
            ? [{ date: "2026-09-17", reports: 1, average_severity: 2 }, { date: "2026-09-18", reports: 3, average_severity: 3 }, { date: "2026-09-19", reports: 2, average_severity: 2.5 }]
            : [{ date: "2026-09-19", reports: 0, average_severity: null }],
        floors: Array.from({ length: dorm.floors ?? 0 }, (_, index) => ({ floor: index + 1, reports: id === 42 && index === 2 ? 6 : 0 })),
    }
}

export async function mockData(page: Page) {
    await mockSignedIn(page)
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: mapData }))
    await page.route(/\/api\/dorms\?/, (route) => route.fulfill({ json: dormList }))
    await page.route(/\/api\/dorms\/\d+\?/, (route) => {
        const url = new URL(route.request().url())
        return route.fulfill({ json: dormDetail(Number(url.pathname.split("/").pop()), url.searchParams.get("days") === "all" ? "all" : Number(url.searchParams.get("days"))) })
    })
}

// Exercise the component's Maps API contract without making billable Google requests.
export async function mockGoogleMaps(page: Page) {
    await page.addInitScript(() => {
        class TestMap {
            container: HTMLElement
            center: { lat: number; lng: number }
            constructor(container: HTMLElement, options: { center: { lat: number; lng: number } }) {
                this.container = container
                this.setCenter(options.center)
                container.addEventListener("test-pan", () => this.setCenter({ lat: 40, lng: -74 }))
                container.dataset.mapReady = "true"
            }
            setCenter(center: { lat: number; lng: number }) {
                this.center = center
                this.container.dataset.center = JSON.stringify(center)
            }
            fitBounds(bounds: { center: { lat: number; lng: number } }) { this.setCenter(bounds.center) }
            getCenter() { return { lat: () => this.center.lat, lng: () => this.center.lng } }
        }
        class TestCircle {
            options: object
            constructor(options: { map: TestMap; radius: number }) {
                this.options = options
                options.map.container.dataset.radius = String(options.radius)
            }
            getBounds() { return this.options }
            setMap() {}
        }
        class TestPin extends HTMLElement {
            constructor(options: { glyphText: string }) {
                super()
                this.textContent = options.glyphText
            }
        }
        class TestMarker extends HTMLElement {
            constructor(options: { map: TestMap; title: string; gmpClickable: boolean; position: object }) {
                super()
                this.title = options.title
                this.dataset.position = JSON.stringify(options.position)
                this.style.cssText = "display:inline-block;margin:16px;padding:8px;background:white;color:black;cursor:pointer"
                if (options.gmpClickable) {
                    this.setAttribute("role", "button")
                    this.setAttribute("aria-label", options.title)
                }
                this.addEventListener("click", () => this.dispatchEvent(new Event("gmp-click")))
                options.map.container.append(this)
            }
            set map(value: TestMap | null) { if (!value) this.remove() }
        }
        customElements.define("test-pin", TestPin)
        customElements.define("test-marker", TestMarker)
        Object.assign(window, { google: { maps: {
            importLibrary: async (name: string) => name === "maps"
                ? { Map: TestMap, Circle: TestCircle }
                : { AdvancedMarkerElement: TestMarker, PinElement: TestPin },
            event: { clearInstanceListeners() {} },
        } } })
    })
}
