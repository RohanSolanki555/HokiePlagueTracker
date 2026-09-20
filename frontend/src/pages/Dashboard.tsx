import { useCallback, useEffect, useState, type MouseEvent } from "react"
import { Activity, ArrowRight, CalendarDays, Gauge, LogOut, Plus, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react"
import logo from "@/assets/HokiePlagueTrackerIcon.svg"
import "./Dashboard.css"
import DormSection from "@/components/DormSection"
import IllnessSummary from "@/components/IllnessSummary"
import LiveStatus from "@/components/LiveStatus"
import LocationMap from "@/components/LocationMap"
import ReportForm, { type SubmittedReport } from "@/components/ReportForm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCountUp } from "@/lib/use-count-up"
import { api, type LocationMapResponse, type MapQuery } from "@/services/api"

const CAMPUS: MapQuery = { latitude: 37.2274294, longitude: -80.4222303, radius_km: 3, days: 7 }
const EMPTY_LOCATIONS: LocationMapResponse["locations"] = []
const EMPTY_HOME_AREAS: LocationMapResponse["home_areas"] = []

function initialSelection() {
    const id = Number(new URLSearchParams(window.location.search).get("location_id"))
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}

// Glide to the form only for this button; a page-wide smooth scroll would animate every programmatic scroll.
function scrollToReport(event: MouseEvent<HTMLAnchorElement>) {
    const form = document.getElementById("report")
    if (!form) return
    event.preventDefault()
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    form.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
}

const whole = (value: number) => String(Math.round(value))
const signedPercent = (value: number) => trend(Math.round(value))
const severity = (value: number) => value.toFixed(2)

function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
    return <>{format(useCountUp(value) ?? value)}</>
}

interface Props {
    email?: string
    onSignOut?: () => void
    accountError?: string
}

export default function Dashboard({ email, onSignOut, accountError }: Props) {
    const [query, setQuery] = useState(CAMPUS)
    const [refresh, setRefresh] = useState(0)
    const [result, setResult] = useState<{
        query: MapQuery
        refresh: number
        data: LocationMapResponse | null
        error: string | null
    } | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(initialSelection)
    const [hoveredId, setHoveredId] = useState<number | null>(null)
    const [updatedAt, setUpdatedAt] = useState<number | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        api.getLocationMap(query, controller.signal).then((data) => {
            if (controller.signal.aborted) return
            setResult({ query, refresh, data, error: null })
            setUpdatedAt(Date.now())
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

    // Never move the map to a submitted report: home reports have no public position.
    const showSubmittedReport = useCallback(({ dormId }: SubmittedReport) => {
        if (dormId !== null) setSelectedId(dormId)
        setRefresh((value) => value + 1)
    }, [])

    const loading = result?.query !== query || result?.refresh !== refresh
    // Keep the last counts visible during refreshes of the same area.
    const data = result?.query === query ? result.data : null
    const error = loading ? null : result?.error
    const locations = data?.locations ?? EMPTY_LOCATIONS
    const summary = data?.summary

    // `text` is a fixed label; otherwise `number` counts up from its previous value.
    const stats: { label: string; number?: number | null; format: (value: number) => string; text?: string; note: string; icon: typeof Gauge; tone: string }[] = [
        { label: "Reports today", number: summary?.reports_today, format: whole, note: "Since midnight · Eastern time", icon: CalendarDays, tone: "" },
        { label: query.days === "all" ? "All-time reports" : `Reports in ${query.days} days`, number: summary?.total_reports, format: whole, note: "Dorm and off-campus reports in this area", icon: Activity, tone: "" },
        {
            label: "Change from prior period", format: signedPercent,
            number: query.days === "all" || !summary ? undefined : summary.change_percent,
            text: query.days === "all" ? "N/A" : summary && summary.change_percent === null ? trend(null) : undefined,
            note: query.days === "all" ? "No prior period for all time" : `Compared with the previous ${query.days} days`, icon: TrendingUp,
            tone: !summary?.change_percent ? "" : summary.change_percent > 0 ? "up" : "down",
        },
        { label: "Average severity", number: summary?.average_severity, format: severity, note: "Reported severity scores", icon: Gauge, tone: "" },
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
                            <h1 className="dash-title">Campus health <span>in real time.</span></h1>
                            <p className="dash-lead">Explore recent illness reports around Virginia Tech, and report how you’re feeling to help others stay ahead.</p>
                        </div>
                        <div className="dash-hero-actions">
                            <div className="dash-hero-buttons">
                                <a className="dash-cta" href="#report" onClick={scrollToReport}>Report an illness <ArrowRight aria-hidden="true" /></a>
                                <Button variant="ghost" className="dash-ghost" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
                                    <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh data
                                </Button>
                            </div>
                            <LiveStatus updatedAt={updatedAt} loading={loading} failed={!!error} />
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
                            <p className="dash-stat-value" data-tone={stat.tone}>
                                {stat.text ?? (stat.number !== undefined && stat.number !== null
                                    ? <CountUp value={stat.number} format={stat.format} />
                                    : loading && !summary ? <span className="dash-skeleton" aria-hidden="true" /> : "—")}
                            </p>
                            <p className="dash-stat-note">{stat.note}</p>
                        </CardContent>
                    </Card>)}
                </div>

                <IllnessSummary days={query.days} refresh={refresh} />

                {error && <div role="alert" className="dash-feedback dash-feedback-action">
                    <span>{error}</span><Button variant="outline" className="dash-btn-outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button>
                </div>}

                <div className="dash-grid">
                    <div className="dash-main">
                        <div className="dash-panel dash-map-card">
                            <LocationMap query={query} locations={locations} homeAreas={data?.home_areas ?? EMPTY_HOME_AREAS} selectedId={selectedId} hoveredId={hoveredId} onSelect={selectLocation} />
                            <div className="dash-map-foot">
                                <p className="dash-map-count">{data ? `${locations.length} ${locations.length === 1 ? "dorm" : "dorms"} in this area` : loading ? "Loading map data…" : "Data unavailable"}</p>
                                <ul className="dash-legend" aria-label="Map legend">
                                    <li><span className="dash-dot dash-dot-dorm" aria-hidden="true" />Dorm with reports</li>
                                    <li><span className="dash-dot dash-dot-home" aria-hidden="true" />Off-campus area</li>
                                    <li><span className="dash-dot dash-dot-center" aria-hidden="true"><Plus strokeWidth={3} /></span>Drillfield</li>
                                </ul>
                            </div>
                            <div className="dash-map-filters" role="group" aria-label="Map filters">
                                <label className="dash-field"><span>Report period</span>
                                    <select className="dash-select" value={query.days} onChange={(event) => {
                                        const days = Number(event.target.value)
                                        setQuery((current) => ({ ...current, days }))
                                    }}>
                                        <option value="30">30 days</option>
                                        <option value="14">14 days</option>
                                        <option value="7">7 days</option>
                                    </select>
                                </label>
                                <label className="dash-field"><span>Circle radius</span>
                                    <select className="dash-select" value={query.radius_km} onChange={(event) => {
                                        const radius_km = Number(event.target.value)
                                        setQuery((current) => ({ ...current, radius_km }))
                                    }}>
                                        {[0.5, 1, 3, 5].map((radius) => <option key={radius} value={radius}>{radius} km</option>)}
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>

                    <aside className="dash-side" id="report">
                        <ReportForm onSubmitted={showSubmittedReport} />
                    </aside>
                </div>

                <DormSection days={query.days} refresh={refresh} selectedId={selectedId} onSelect={selectLocation} onHover={setHoveredId} />

                <footer className="dash-footer">
                    {!!data?.unmapped_locations && <p>{data.unmapped_locations} dorm(s) have no coordinates yet and are not shown on the map.</p>}
                    {data && <p><ShieldCheck aria-hidden="true" /> Updated {new Date(data.generated_at).toLocaleString()}. Off-campus reports appear only as approximate, unclickable areas.</p>}
                </footer>
            </div>
        </main>
    )
}
