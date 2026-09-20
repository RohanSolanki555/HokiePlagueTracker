import { useEffect, useState } from "react"
import { ArrowUpRight, Building2, Search } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { api, type DormDetail, type DormListResponse, type ReportPeriod } from "@/services/api"

interface Props {
    days: ReportPeriod
    refresh: number
    selectedId: number | null
    onSelect: (id: number) => void
    onHover?: (id: number | null) => void
}

type Sort = "reports" | "name"

const illnessChart = { reports: { label: "Reports", color: "#801036" } } satisfies ChartConfig
const dailyChart = { reports: { label: "Reports", color: "#ef620f" } } satisfies ChartConfig
const floorChart = { reports: { label: "Reports", color: "#801036" } } satisfies ChartConfig

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}

function shortDate(isoDate: string) {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function message(reason: unknown, fallback: string) {
    return reason instanceof Error ? reason.message : fallback
}

export default function DormSection({ days, refresh, selectedId, onSelect, onHover }: Props) {
    const [search, setSearch] = useState("")
    const [sort, setSort] = useState<Sort>("reports")
    const [list, setList] = useState<{ days: ReportPeriod; refresh: number; data: DormListResponse | null; error: string | null } | null>(null)
    const [detail, setDetail] = useState<{ key: string; refresh: number; data: DormDetail | null; error: string | null } | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        api.getDorms(days, controller.signal).then((data) => {
            if (!controller.signal.aborted) setList({ days, refresh, data, error: null })
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setList({ days, refresh, data: null, error: message(reason, "Dorm data could not load.") })
        })
        return () => controller.abort()
    }, [days, refresh])

    const detailKey = selectedId === null ? "" : `${selectedId}:${days}`
    useEffect(() => {
        if (selectedId === null) return
        const controller = new AbortController()
        api.getDorm(selectedId, days, controller.signal).then((data) => {
            if (!controller.signal.aborted) setDetail({ key: detailKey, refresh, data, error: null })
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setDetail({ key: detailKey, refresh, data: null, error: message(reason, "Dorm details could not load.") })
        })
        return () => controller.abort()
    }, [selectedId, days, refresh, detailKey])

    // Keep the last counts on screen while a refresh for the same dorm/period is in flight.
    const listCurrent = list?.days === days ? list : null
    const listLoading = !list || list.days !== days || list.refresh !== refresh
    const dorms = listCurrent?.data?.dorms ?? []
    const filtered = dorms.filter((dorm) => dorm.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => (sort === "reports" ? b.stats.total_reports - a.stats.total_reports : 0) || a.name.localeCompare(b.name))
    const detailCurrent = detail?.key === detailKey ? detail : null
    const detailLoading = selectedId !== null && (!detailCurrent || detailCurrent.refresh !== refresh)
    const detailData = selectedId === null ? null : detailCurrent?.data ?? null
    const detailError = selectedId === null || detailLoading ? null : detailCurrent?.error

    return (
        <div className="dash-dorms">
            <Card className="dash-panel dash-dorm-panel">
                <CardHeader className="dash-dorm-head">
                    <span className="dash-label">Residence halls</span>
                    <CardTitle className="dash-panel-title">Virginia Tech dorms</CardTitle>
                    <p className="dash-panel-desc">Pick a dorm to see how many reports it has and what is going around.</p>
                </CardHeader>
                <CardContent className="dash-dorm-body">
                    <div className="dash-dorm-tools">
                        <div className="dash-input-wrap">
                            <Search className="dash-input-icon" aria-hidden="true" />
                            <Input className="dash-input" aria-label="Filter dorms" placeholder="Filter dorms by name…" value={search} onChange={(event) => setSearch(event.target.value)} />
                        </div>
                        <select className="dash-select" aria-label="Sort dorms" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                            <option value="reports">Most reports</option>
                            <option value="name">A–Z</option>
                        </select>
                    </div>
                    {!listLoading && listCurrent?.error && <div role="alert" className="dash-feedback dash-feedback-action">
                        <span>{listCurrent.error}</span>
                    </div>}
                    <div className="dash-dorm-list" aria-busy={listLoading}>
                        {filtered.map((dorm) => <button key={dorm.id} type="button" aria-pressed={selectedId === dorm.id} onClick={() => onSelect(dorm.id)} className="dash-dorm"
                            onMouseEnter={() => onHover?.(dorm.id)} onMouseLeave={() => onHover?.(null)}
                            onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) onHover?.(dorm.id) }} onBlur={() => onHover?.(null)}>
                            <span className="dash-dorm-icon"><Building2 aria-hidden="true" /></span>
                            <span className="dash-dorm-text">
                                <span className="dash-dorm-name">{dorm.name}</span>
                                {dorm.floors && <span className="dash-dorm-floors">{dorm.floors} floors</span>}
                            </span>
                            <span className="dash-dorm-count" data-active={dorm.stats.total_reports > 0}>{dorm.stats.total_reports} reports</span>
                        </button>)}
                        {filtered.length === 0 && !listCurrent?.error && <p className="dash-empty-line" role="status">
                            {listLoading && !listCurrent ? "Loading dorms…" : dorms.length ? "No dorms match that name." : "No dorms have been added yet."}
                        </p>}
                    </div>
                </CardContent>
            </Card>

            <Card className="dash-panel dash-dorm-panel">
                <CardHeader className="dash-dorm-head">
                    <span className="dash-label">Statistics</span>
                    <CardTitle className="dash-panel-title">{detailData ? detailData.dorm.name : "Dorm statistics"}</CardTitle>
                </CardHeader>
                <CardContent className="dash-dorm-body">
                    {selectedId === null && <div className="dash-empty">
                        <Building2 aria-hidden="true" />
                        <p>Select a dorm from the list or the map to see its illness breakdown, daily trend, and floors.</p>
                    </div>}
                    {detailError && <div role="alert" className="dash-feedback dash-feedback-action"><span>{detailError}</span></div>}
                    {selectedId !== null && !detailData && !detailError && <p className="dash-empty-line" role="status">Loading dorm details…</p>}
                    {detailData && <DormDetailView detail={detailData} />}
                </CardContent>
            </Card>
        </div>
    )
}

function DormDetailView({ detail }: { detail: DormDetail }) {
    const { stats, dorm } = detail
    const empty = stats.total_reports === 0
    return (
        <div className="dash-detail" aria-live="polite">
            <dl className="dash-tiles">
                {[
                    ["Reports today", stats.reports_today],
                    [detail.days === "all" ? "All-time reports" : `Reports in ${detail.days} days`, stats.total_reports],
                    ["Average severity", stats.average_severity?.toFixed(2) ?? "No scores"],
                    ["Change from prior period", detail.days === "all" ? "N/A" : trend(stats.change_percent)],
                ].map(([label, value]) => <div key={label} className="dash-tile"><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <p className="dash-latest">{stats.latest_report_at ? `Latest report: ${new Date(stats.latest_report_at).toLocaleString()}` : "No reports during this period."}</p>

            {!empty && <>
                <section aria-label="Illnesses reported" className="dash-chart">
                    <h3>Illnesses reported</h3>
                    <ChartContainer config={illnessChart} className="w-full" style={{ height: Math.max(120, detail.illnesses.length * 36 + 24), aspectRatio: "auto" }}>
                        <BarChart data={detail.illnesses} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <CartesianGrid horizontal={false} />
                            <YAxis dataKey="illness" type="category" tickLine={false} axisLine={false} width={140} />
                            <XAxis type="number" allowDecimals={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={6} />
                        </BarChart>
                    </ChartContainer>
                </section>

                <section aria-label="Reports per day" className="dash-chart">
                    <h3>Reports per day</h3>
                    <ChartContainer config={dailyChart} className="h-48 w-full" style={{ aspectRatio: "auto" }}>
                        <BarChart data={detail.daily} margin={{ left: 0, right: 8 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={shortDate} interval="preserveStartEnd" />
                            <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_label, payload) => shortDate(String(payload?.[0]?.payload?.date ?? ""))} />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={6} />
                        </BarChart>
                    </ChartContainer>
                </section>

                {detail.floors.length > 0 && <section aria-label="Reports by floor" className="dash-chart">
                    <h3>Reports by floor</h3>
                    <ChartContainer config={floorChart} className="h-52 w-full" style={{ aspectRatio: "auto" }}>
                        <BarChart data={detail.floors} margin={{ left: 0, right: 8, bottom: 12 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="floor" tickLine={false} axisLine={false} label={{ value: "Floor", position: "insideBottom", offset: -2 }} height={40} />
                            <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_label, payload) => `Floor ${payload?.[0]?.payload?.floor ?? ""}`} />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={6} />
                        </BarChart>
                    </ChartContainer>
                </section>}
            </>}

            {dorm.latitude !== null && dorm.longitude !== null && <a className="dash-link dash-detail-link" href={`https://www.google.com/maps/search/?api=1&query=${dorm.latitude},${dorm.longitude}`} target="_blank" rel="noopener noreferrer">Open in Google Maps <ArrowUpRight aria-hidden="true" /></a>}
        </div>
    )
}
