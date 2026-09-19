import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Activity, ArrowUpRight, MapPin, RefreshCw } from "lucide-react"
import LocationMap from "@/components/LocationMap"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api, type LocationMapResponse, type MapQuery } from "@/services/api"

const CAMPUS: MapQuery = { latitude: 37.2296, longitude: -80.4139, radius_km: 3, days: 7 }
const EMPTY_LOCATIONS: LocationMapResponse["locations"] = []
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}
import ReportForm from "@/components/ReportForm"

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
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [search, setSearch] = useState("")

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

    const selectLocation = useCallback((id: number) => setSelectedId(id), [])
    const changeCenter = useCallback((lat: number, lng: number) => {
        setLatitude(String(lat))
        setLongitude(String(lng))
        setSelectedId(null)
        setQuery((current) => ({ ...current, latitude: lat, longitude: lng }))
    }, [])

    function applyFilters(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setSelectedId(null)
        setQuery({ latitude: Number(latitude), longitude: Number(longitude), radius_km: Number(radius), days: Number(days) })
    }

    function resetCampus() {
        setLatitude(String(CAMPUS.latitude))
        setLongitude(String(CAMPUS.longitude))
        setRadius(String(CAMPUS.radius_km))
        setDays(String(CAMPUS.days))
        setSelectedId(null)
        setSearch("")
        setQuery({ ...CAMPUS })
    }

    const loading = result?.query !== query || result?.refresh !== refresh
    const data = loading ? null : result?.data
    const error = loading ? null : result?.error
    const locations = data?.locations ?? EMPTY_LOCATIONS
    const filtered = locations.filter((location) => location.name.toLowerCase().includes(search.toLowerCase()))
    const selected = locations.find((location) => location.id === selectedId)
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
                    <p>{data ? `${locations.length} saved locations` : loading ? "Loading location data…" : "Data unavailable"}</p>
                </div>

                {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
                    <span>{error}</span><Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
                </div>}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
                    {[
                        { label: "Reports today", value: summary?.reports_today, note: "Since midnight · Eastern time" },
                        { label: `Reports in ${query.days} days`, value: summary?.total_reports, note: "At saved locations in this area" },
                        { label: "Change from prior period", value: summary ? trend(summary.change_percent) : undefined, note: `Compared with the previous ${query.days} days` },
                        { label: "Average severity", value: summary?.average_severity?.toFixed(2), note: "Reported severity scores" },
                    ].map((stat) => <Card key={stat.label}>
                        <CardHeader><CardTitle className="text-sm text-muted-foreground">{stat.label}</CardTitle></CardHeader>
                        <CardContent><p className="text-3xl font-semibold tracking-tight">{stat.value ?? "—"}</p><p className="mt-2 text-xs text-muted-foreground">{stat.note}</p></CardContent>
                    </Card>)}
                </div>

                <LocationMap query={query} locations={locations} selectedId={selectedId} onSelect={selectLocation} onCenterChange={changeCenter} />
                <p className="text-xs text-muted-foreground">Pin numbers show reports in the selected period. The + pin marks the search center. Select a pin or a location below to view its statistics.</p>

                <div className="grid items-start gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader><CardTitle>Nearby locations</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <Input aria-label="Filter nearby locations" placeholder="Filter locations by name…" value={search} onChange={(event) => setSearch(event.target.value)} />
                            <div className="max-h-80 space-y-2 overflow-y-auto" aria-busy={loading}>
                                {filtered.map((location) => <button key={location.id} type="button" aria-pressed={selectedId === location.id} onClick={() => selectLocation(location.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#861f41] ${selectedId === location.id ? "border-[#861f41] bg-[#861f41]/5" : "border-transparent bg-zinc-50"}`}>
                                    <MapPin className="size-5 shrink-0 text-[#861f41]" />
                                    <span className="min-w-0 flex-1"><span className="block font-medium">{location.name}</span><span className="text-xs text-muted-foreground">{location.location_type.replaceAll("_", " ")} · {location.distance_km.toFixed(2)} km away</span></span>
                                    <span className="shrink-0 text-sm font-medium">{location.stats.total_reports} reports</span>
                                </button>)}
                                {filtered.length === 0 && <p className="py-6 text-sm text-muted-foreground" role="status">{loading ? "Loading nearby locations…" : error ? "Locations could not be loaded." : locations.length ? "No locations match that name." : "No saved locations in this area. Try a wider radius or another center."}</p>}
                            </div>
                            {!!data?.unmapped_locations && <p className="text-xs text-muted-foreground">{data.unmapped_locations} saved location(s) have no valid coordinates and are excluded from the map and area totals.</p>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>{selected ? selected.name : "Location statistics"}</CardTitle></CardHeader>
                        <CardContent>
                            {selected ? <div className="space-y-5" aria-live="polite">
                                <p className="text-sm text-muted-foreground">{selected.location_type.replaceAll("_", " ")} · {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</p>
                                <dl className="grid grid-cols-2 gap-5">
                                    {[
                                        ["Reports today", selected.stats.reports_today],
                                        [`Reports in ${query.days} days`, selected.stats.total_reports],
                                        ["Average severity", selected.stats.average_severity?.toFixed(2) ?? "No scores"],
                                        ["Change from prior period", trend(selected.stats.change_percent)],
                                    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}
                                </dl>
                                <p className="text-xs text-muted-foreground">{selected.stats.latest_report_at ? `Latest report: ${new Date(selected.stats.latest_report_at).toLocaleString()}` : "No reports during this period."}</p>
                                <a className="inline-flex items-center gap-1 text-sm font-medium text-[#861f41] underline underline-offset-4" href={`https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}`} target="_blank" rel="noopener noreferrer">Open in Google Maps <ArrowUpRight className="size-4" /></a>
                            </div> : <p className="py-6 text-sm text-muted-foreground">Select a map pin or nearby location to explore its report counts, severity, and recent trend.</p>}
                        </CardContent>
                    </Card>
                </div>
                {data && <p className="text-xs text-muted-foreground">Updated {new Date(data.generated_at).toLocaleString()}. Statistics reflect submitted reports at saved locations.</p>}
            </div>
        </main>
    )
}
