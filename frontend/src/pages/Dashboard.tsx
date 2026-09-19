import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Activity, ArrowRight, CalendarDays, Gauge, LogOut, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react"
import logo from "@/assets/HokiePlagueTrackerIcon.svg"
import "./Dashboard.css"
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

function initialSelection() {
    const id = Number(new URLSearchParams(window.location.search).get("location_id"))
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}

interface Props {
    email?: string
    onSignOut?: () => void
    accountError?: string
}

export default function Dashboard({ email, onSignOut, accountError }: Props) {
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

    const stats = [
        { label: "Reports today", value: summary?.reports_today, note: "Since midnight · Eastern time", icon: CalendarDays, tone: "" },
        { label: `Reports in ${query.days} days`, value: summary?.total_reports, note: "Dorm and off-campus reports in this area", icon: Activity, tone: "" },
        {
            label: "Change from prior period", value: summary ? trend(summary.change_percent) : undefined,
            note: `Compared with the previous ${query.days} days`, icon: TrendingUp,
            tone: !summary?.change_percent ? "" : summary.change_percent > 0 ? "up" : "down",
        },
        { label: "Average severity", value: summary?.average_severity?.toFixed(2), note: "Reported severity scores", icon: Gauge, tone: "" },
    ]

    return (
        <main className="dash-page">
            <div className="dash-shell">
                <header className="dash-hero">
                    <div className="dash-topbar">
                        <a className="dash-brand" href="/" aria-label="Hokie Plague Tracker home">
                            <span className="dash-brand-logo"><img src={logo} alt="" width="54" height="54" /></span>
                            <span className="dash-brand-name">Hokie<span>Plague Tracker</span></span>
                        </a>
                        {onSignOut && <div className="dash-account">
                            {email && <span className="dash-user">
                                <span className="dash-avatar" aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
                                <span className="dash-user-email">{email}</span>
                            </span>}
                            <Button variant="ghost" className="dash-ghost dash-signout" onClick={onSignOut}><LogOut aria-hidden="true" /> Sign out</Button>
                        </div>}
                        {accountError && <p role="alert" className="dash-account-error">{accountError}</p>}
                    </div>

                    <div className="dash-hero-body">
                        <div className="dash-hero-copy">
                            <p className="dash-eyebrow">Hokies helping Hokies</p>
                            <h1 className="dash-title">Campus health, <span>in real time.</span></h1>
                            <p className="dash-lead">Explore recent illness reports around Virginia Tech, and report how you’re feeling to help others stay ahead.</p>
                        </div>
                        <div className="dash-hero-actions">
                            <div className="dash-hero-buttons">
                                <a className="dash-cta" href="#report">Report an illness <ArrowRight aria-hidden="true" /></a>
                                <Button variant="ghost" className="dash-ghost" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
                                    <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh data
                                </Button>
                            </div>
                            <p className="dash-live"><span className="dash-live-dot" aria-hidden="true" /> Live · refreshes every 15 seconds</p>
                        </div>
                    </div>
                </header>

                <div className="dash-stats" aria-busy={loading}>
                    {stats.map((stat) => <Card key={stat.label} className="dash-stat">
                        <CardHeader className="dash-stat-head">
                            <CardTitle className="dash-stat-label">{stat.label}</CardTitle>
                            <span className="dash-stat-icon"><stat.icon aria-hidden="true" /></span>
                        </CardHeader>
                        <CardContent className="dash-stat-body">
                            <p className="dash-stat-value" data-tone={stat.tone}>{stat.value ?? "—"}</p>
                            <p className="dash-stat-note">{stat.note}</p>
                        </CardContent>
                    </Card>)}
                </div>

                {error && <div role="alert" className="dash-feedback dash-feedback-action">
                    <span>{error}</span><Button variant="outline" className="dash-btn-outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
                </div>}

                <div className="dash-grid">
                    <div className="dash-main">
                        <section className="dash-panel dash-filters">
                            <span className="dash-label">Explore an area</span>
                            <p className="dash-panel-desc">Enter a center point, or move the map and choose “Search this area.”</p>
                            <form onSubmit={applyFilters} className="dash-filter-form">
                                <label className="dash-field"><span>Latitude</span>
                                    <Input className="dash-input" type="number" min={-90} max={90} step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} />
                                </label>
                                <label className="dash-field"><span>Longitude</span>
                                    <Input className="dash-input" type="number" min={-180} max={180} step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} />
                                </label>
                                <label className="dash-field"><span>Search radius</span>
                                    <select className="dash-select" value={radius} onChange={(event) => setRadius(event.target.value)}>
                                        {[0.5, 1, 3, 5, 10, 25, 100].map((value) => <option key={value} value={value}>{value} km</option>)}
                                    </select>
                                </label>
                                <label className="dash-field"><span>Report period</span>
                                    <select className="dash-select" value={days} onChange={(event) => setDays(event.target.value)}>
                                        {[7, 14, 30].map((value) => <option key={value} value={value}>Last {value} days</option>)}
                                    </select>
                                </label>
                                <div className="dash-filter-actions">
                                    <p className="dash-filter-summary">Within {query.radius_km} km of {query.latitude.toFixed(4)}, {query.longitude.toFixed(4)} · Last {query.days} days</p>
                                    <div className="dash-filter-buttons">
                                        <Button type="button" variant="outline" className="dash-btn-outline" onClick={resetCampus}>Virginia Tech</Button>
                                        <Button type="submit" className="dash-btn-primary">Update map</Button>
                                    </div>
                                </div>
                            </form>
                        </section>

                        <div className="dash-panel dash-map-card">
                            <LocationMap query={query} locations={locations} homeAreas={data?.home_areas ?? EMPTY_HOME_AREAS} selectedId={selectedId} onSelect={selectLocation} onCenterChange={changeCenter} />
                            <div className="dash-map-foot">
                                <p className="dash-map-count">{data ? `${locations.length} ${locations.length === 1 ? "dorm" : "dorms"} in this area` : loading ? "Loading map data…" : "Data unavailable"}</p>
                                <ul className="dash-legend" aria-label="Map legend">
                                    <li><span className="dash-dot dash-dot-dorm" aria-hidden="true" />Dorm with reports</li>
                                    <li><span className="dash-dot dash-dot-home" aria-hidden="true" />Off-campus area</li>
                                    <li><span className="dash-dot dash-dot-center" aria-hidden="true">+</span>Search center</li>
                                </ul>
                            </div>
                            <p className="dash-caption">A dorm gets a pin once it has a report. Pin numbers show reports in the selected period and refresh every 15 seconds. Off-campus reports appear only as approximate gray dots that cannot be selected. Select a dorm pin or a dorm below to view its statistics.</p>
                        </div>
                    </div>

                    <aside className="dash-side" id="report">
                        <ReportForm onSubmitted={showSubmittedReport} />
                    </aside>
                </div>

                <DormSection days={query.days} refresh={refresh} selectedId={selectedId} onSelect={selectLocation} />

                <footer className="dash-footer">
                    {!!data?.unmapped_locations && <p>{data.unmapped_locations} dorm(s) have no coordinates yet and are not shown on the map.</p>}
                    {data && <p><ShieldCheck aria-hidden="true" /> Updated {new Date(data.generated_at).toLocaleString()}. Off-campus reports appear only as approximate, unclickable areas.</p>}
                </footer>
            </div>
        </main>
    )
}
