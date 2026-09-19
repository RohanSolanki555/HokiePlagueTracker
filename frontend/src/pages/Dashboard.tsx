import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Activity, RefreshCw } from "lucide-react"
import DormSection from "@/components/DormSection"
import LocationMap from "@/components/LocationMap"
import ReportForm, { type SubmittedReport } from "@/components/ReportForm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type LocationMapResponse, type MapQuery } from "@/services/api"

const CAMPUS: MapQuery = { latitude: 37.2296, longitude: -80.4139, radius_km: 3, days: 7 }
const EMPTY_LOCATIONS: LocationMapResponse["locations"] = []
const EMPTY_HOME_AREAS: LocationMapResponse["home_areas"] = []
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"

function initialSelection() {
    const id = Number(new URLSearchParams(window.location.search).get("location_id"))
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}

export default function Dashboard() {
    const [query, setQuery] = useState(CAMPUS)
    const [latitude, setLatitude] = useState(String(CAMPUS.latitude))
    const [longitude, setLongitude] = useState(String(CAMPUS.longitude))
    const [radius, setRadius] = useState(String(CAMPUS.radius_km))
    const [days, setDays] = useState(String(CAMPUS.days))
    const [refresh, setRefresh] = useState(0)
    const [result, setResult] = useState<{
        query: MapQuery
        refresh: number
        data: LocationMapResponse | null
        error: string | null
    } | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(initialSelection)

    useEffect(() => {
        const controller = new AbortController()
        api.getLocationMap(query, controller.signal).then((data) => {
            if (!controller.signal.aborted) setResult({ query, refresh, data, error: null })
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setResult({
                query, refresh, data: null,
                error: reason instanceof Error ? reason.message : "Location data could not load.",
            })
        })
        return () => controller.abort()
    }, [query, refresh])

    useEffect(() => {
        const refreshVisible = () => {
            if (!document.hidden) setRefresh((value) => value + 1)
        }
        const timer = window.setInterval(refreshVisible, 15000)
        window.addEventListener("focus", refreshVisible)
        document.addEventListener("visibilitychange", refreshVisible)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener("focus", refreshVisible)
            document.removeEventListener("visibilitychange", refreshVisible)
        }
    }, [])

    const selectLocation = useCallback((id: number) => setSelectedId(id), [])
    const changeCenter = useCallback((lat: number, lng: number) => {
        setLatitude(String(lat))
        setLongitude(String(lng))
        setQuery((current) => ({ ...current, latitude: lat, longitude: lng }))
    }, [])

    // Never move the map to a submitted report: home reports have no public position.
    const showSubmittedReport = useCallback(({ dormId }: SubmittedReport) => {
        if (dormId !== null) setSelectedId(dormId)
        setRefresh((value) => value + 1)
    }, [])

    function applyFilters(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setQuery({ latitude: Number(latitude), longitude: Number(longitude), radius_km: Number(radius), days: Number(days) })
    }

    function resetCampus() {
        setLatitude(String(CAMPUS.latitude))
        setLongitude(String(CAMPUS.longitude))
        setRadius(String(CAMPUS.radius_km))
        setDays(String(CAMPUS.days))
        setQuery({ ...CAMPUS })
    }

    const loading = result?.query !== query || result?.refresh !== refresh
    // Keep the last counts visible during refreshes of the same area.
    const data = result?.query === query ? result.data : null
    const error = loading ? null : result?.error
    const locations = data?.locations ?? EMPTY_LOCATIONS
    const summary = data?.summary

    return (
        <main className="min-h-screen bg-zinc-50 px-4 py-8 sm:px-8">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-[#861f41] uppercase"><Activity className="size-4" /> Hokie Plague Tracker</p>
                        <h1 className="text-3xl font-bold tracking-tight">Campus Health</h1>
                        <p className="mt-2 text-muted-foreground">Explore recent illness reports around Virginia Tech and beyond.</p>
                    </div>
                    <Button variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
                        <RefreshCw className={loading ? "animate-spin" : ""} /> Refresh data
                    </Button>
                </header>

                <Card>
                    <CardHeader>
                        <CardTitle>Explore an area</CardTitle>
                        <p className="text-muted-foreground">Enter a center point, or move the map and choose “Search this area.”</p>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={applyFilters} className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
                            <label className="space-y-2 text-sm font-medium">Latitude
                                <Input className="mt-2 h-9" type="number" min={-90} max={90} step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} />
                            </label>
                            <label className="space-y-2 text-sm font-medium">Longitude
                                <Input className="mt-2 h-9" type="number" min={-180} max={180} step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} />
                            </label>
                            <label className="space-y-2 text-sm font-medium">Search radius
                                <select className={`mt-2 ${selectClass}`} value={radius} onChange={(event) => setRadius(event.target.value)}>
                                    {[0.5, 1, 3, 5, 10, 25, 100].map((value) => <option key={value} value={value}>{value} km</option>)}
                                </select>
                            </label>
                            <label className="space-y-2 text-sm font-medium">Report period
                                <select className={`mt-2 ${selectClass}`} value={days} onChange={(event) => setDays(event.target.value)}>
                                    {[7, 14, 30].map((value) => <option key={value} value={value}>Last {value} days</option>)}
                                </select>
                            </label>
                            <Button type="submit" size="lg" className="bg-[#861f41] hover:bg-[#6b1934]">Update map</Button>
                            <Button type="button" variant="outline" size="lg" onClick={resetCampus}>Virginia Tech</Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <p>Within {query.radius_km} km of {query.latitude.toFixed(4)}, {query.longitude.toFixed(4)} · Last {query.days} days</p>
                    <p>{data ? `${locations.length} ${locations.length === 1 ? "dorm" : "dorms"} in this area` : loading ? "Loading map data…" : "Data unavailable"}</p>
                </div>

                {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
                    <span>{error}</span><Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
                </div>}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
                    {[
                        { label: "Reports today", value: summary?.reports_today, note: "Since midnight · Eastern time" },
                        { label: `Reports in ${query.days} days`, value: summary?.total_reports, note: "Dorm and off-campus reports in this area" },
                        { label: "Change from prior period", value: summary ? trend(summary.change_percent) : undefined, note: `Compared with the previous ${query.days} days` },
                        { label: "Average severity", value: summary?.average_severity?.toFixed(2), note: "Reported severity scores" },
                    ].map((stat) => <Card key={stat.label}>
                        <CardHeader><CardTitle className="text-sm text-muted-foreground">{stat.label}</CardTitle></CardHeader>
                        <CardContent><p className="text-3xl font-semibold tracking-tight">{stat.value ?? "—"}</p><p className="mt-2 text-xs text-muted-foreground">{stat.note}</p></CardContent>
                    </Card>)}
                </div>

                <ReportForm onSubmitted={showSubmittedReport} />
                <LocationMap query={query} locations={locations} homeAreas={data?.home_areas ?? EMPTY_HOME_AREAS} selectedId={selectedId} onSelect={selectLocation} onCenterChange={changeCenter} />
                <p className="text-xs text-muted-foreground">Maroon pins are dorms; their numbers show reports in the selected period and refresh every 15 seconds. Small gray dots are approximate areas of off-campus reports and cannot be selected. The + pin marks the search center. Select a dorm pin or a dorm below to view its statistics.</p>

                <DormSection days={query.days} refresh={refresh} selectedId={selectedId} onSelect={selectLocation} />
                {!!data?.unmapped_locations && <p className="text-xs text-muted-foreground">{data.unmapped_locations} dorm(s) have no coordinates yet and are not shown on the map.</p>}
                {data && <p className="text-xs text-muted-foreground">Updated {new Date(data.generated_at).toLocaleString()}. Off-campus reports appear only as approximate, unclickable areas.</p>}
            </div>
        </main>
    )
}
