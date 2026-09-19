import type { Page } from "@playwright/test"
import type { LocationMapResponse } from "../src/services/api"

export const mapData: LocationMapResponse = {
    center: { latitude: 37.2296, longitude: -80.4139 }, radius_km: 3, days: 7,
    generated_at: "2026-09-19T12:00:00Z", unmapped_locations: 1,
    summary: { total_reports: 6, reports_today: 2, previous_period_reports: 3, change_percent: 100, average_severity: 2.5, latest_report_at: "2026-09-19T11:00:00Z" },
    locations: [
        {
            id: 42, name: "Newman Library", location_type: "library", latitude: 37.2284, longitude: -80.4198, distance_km: 0.54,
            stats: { total_reports: 6, reports_today: 2, previous_period_reports: 3, change_percent: 100, average_severity: 2.5, latest_report_at: "2026-09-19T11:00:00Z" },
        },
        {
            id: 99, name: "Squires Student Center", location_type: "student_center", latitude: 37.2296, longitude: -80.4179, distance_km: 0.35,
            stats: { total_reports: 0, reports_today: 0, previous_period_reports: 0, change_percent: 0, average_severity: null, latest_report_at: null },
        },
    ],
}

export async function mockData(page: Page) {
    await page.route("**/api/locations/map?*", (route) => route.fulfill({ json: mapData }))
}

// Exercise the component's Maps API contract without making billable Google requests.
export async function mockGoogleMaps(page: Page) {
    await page.addInitScript(() => {
        class TestMap {
            container: HTMLElement
            center: { lat: number; lng: number }
            constructor(container: HTMLElement, options: { center: { lat: number; lng: number } }) {
                this.container = container
                this.center = options.center
                container.dataset.mapReady = "true"
            }
            fitBounds(bounds: { center: { lat: number; lng: number } }) { this.center = bounds.center }
            getCenter() { return { lat: () => this.center.lat, lng: () => this.center.lng } }
        }
        class TestCircle {
            options: object
            constructor(options: object) { this.options = options }
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
