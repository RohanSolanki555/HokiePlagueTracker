import { useEffect, useState } from "react"
import { ArrowUpRight, Building2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { api, type DormDetail, type DormListResponse } from "@/services/api"

interface Props {
    days: number
    refresh: number
    selectedId: number | null
    onSelect: (id: number) => void
}

const illnessChart = { reports: { label: "Reports", color: "#861f41" } } satisfies ChartConfig
const dailyChart = { reports: { label: "Reports", color: "#e87722" } } satisfies ChartConfig
const floorChart = { reports: { label: "Reports", color: "#861f41" } } satisfies ChartConfig

function trend(value: number | null) {
    return value === null ? "New reports" : `${value > 0 ? "+" : ""}${value}%`
}

function shortDate(isoDate: string) {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function message(reason: unknown, fallback: string) {
    return reason instanceof Error ? reason.message : fallback
}

export default function DormSection({ days, refresh, selectedId, onSelect }: Props) {
    const [search, setSearch] = useState("")
    const [list, setList] = useState<{ days: number; refresh: number; data: DormListResponse | null; error: string | null } | null>(null)
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
    const detailCurrent = detail?.key === detailKey ? detail : null
    const detailLoading = selectedId !== null && (!detailCurrent || detailCurrent.refresh !== refresh)
    const detailData = selectedId === null ? null : detailCurrent?.data ?? null
    const detailError = selectedId === null || detailLoading ? null : detailCurrent?.error

    return (
        <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
                <CardHeader><CardTitle>Virginia Tech dorms</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <Input aria-label="Filter dorms" placeholder="Filter dorms by name…" value={search} onChange={(event) => setSearch(event.target.value)} />
                    {!listLoading && listCurrent?.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
                        <span>{listCurrent.error}</span>
                    </div>}
                    <div className="max-h-96 space-y-2 overflow-y-auto" aria-busy={listLoading}>
                        {filtered.map((dorm) => <button key={dorm.id} type="button" aria-pressed={selectedId === dorm.id} onClick={() => onSelect(dorm.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#861f41] ${selectedId === dorm.id ? "border-[#861f41] bg-[#861f41]/5" : "border-transparent bg-zinc-50"}`}>
                            <Building2 className="size-5 shrink-0 text-[#861f41]" />
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium">{dorm.name}</span>
                                {dorm.floors && <span className="text-xs text-muted-foreground">{dorm.floors} floors</span>}
                            </span>
                            <span className="shrink-0 text-sm font-medium">{dorm.stats.total_reports} reports</span>
                        </button>)}
                        {filtered.length === 0 && !listCurrent?.error && <p className="py-6 text-sm text-muted-foreground" role="status">
                            {listLoading && !listCurrent ? "Loading dorms…" : dorms.length ? "No dorms match that name." : "No dorms have been added yet."}
                        </p>}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>{detailData ? detailData.dorm.name : "Dorm statistics"}</CardTitle></CardHeader>
                <CardContent>
                    {selectedId === null && <p className="py-6 text-sm text-muted-foreground">Select a dorm from the list or the map to see its illness breakdown, daily trend, and floors.</p>}
                    {detailError && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">{detailError}</div>}
                    {selectedId !== null && !detailData && !detailError && <p className="py-6 text-sm text-muted-foreground" role="status">Loading dorm details…</p>}
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
        <div className="space-y-6" aria-live="polite">
            <dl className="grid grid-cols-2 gap-5">
                {[
                    ["Reports today", stats.reports_today],
                    [`Reports in ${detail.days} days`, stats.total_reports],
                    ["Average severity", stats.average_severity?.toFixed(2) ?? "No scores"],
                    ["Change from prior period", trend(stats.change_percent)],
                ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}
            </dl>
            <p className="text-xs text-muted-foreground">{stats.latest_report_at ? `Latest report: ${new Date(stats.latest_report_at).toLocaleString()}` : "No reports during this period."}</p>

            {!empty && <>
                <section aria-label="Illnesses reported" className="space-y-2">
                    <h3 className="text-sm font-medium">Illnesses reported</h3>
                    <ChartContainer config={illnessChart} className="w-full" style={{ height: Math.max(120, detail.illnesses.length * 36 + 24), aspectRatio: "auto" }}>
                        <BarChart data={detail.illnesses} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <CartesianGrid horizontal={false} />
                            <YAxis dataKey="illness" type="category" tickLine={false} axisLine={false} width={140} />
                            <XAxis type="number" allowDecimals={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={4} />
                        </BarChart>
                    </ChartContainer>
                </section>

                <section aria-label="Reports per day" className="space-y-2">
                    <h3 className="text-sm font-medium">Reports per day</h3>
                    <ChartContainer config={dailyChart} className="h-48 w-full" style={{ aspectRatio: "auto" }}>
                        <BarChart data={detail.daily} margin={{ left: 0, right: 8 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={shortDate} interval="preserveStartEnd" />
                            <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_label, payload) => shortDate(String(payload?.[0]?.payload?.date ?? ""))} />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={4} />
                        </BarChart>
                    </ChartContainer>
                </section>

                {detail.floors.length > 0 && <section aria-label="Reports by floor" className="space-y-2">
                    <h3 className="text-sm font-medium">Reports by floor</h3>
                    <ChartContainer config={floorChart} className="h-44 w-full" style={{ aspectRatio: "auto" }}>
                        <BarChart data={detail.floors} margin={{ left: 0, right: 8 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="floor" tickLine={false} axisLine={false} label={{ value: "Floor", position: "insideBottom", offset: -2 }} height={40} />
                            <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
                            <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_label, payload) => `Floor ${payload?.[0]?.payload?.floor ?? ""}`} />} />
                            <Bar dataKey="reports" fill="var(--color-reports)" radius={4} />
                        </BarChart>
                    </ChartContainer>
                </section>}
            </>}

            {dorm.latitude !== null && dorm.longitude !== null && <a className="inline-flex items-center gap-1 text-sm font-medium text-[#861f41] underline underline-offset-4" href={`https://www.google.com/maps/search/?api=1&query=${dorm.latitude},${dorm.longitude}`} target="_blank" rel="noopener noreferrer">Open in Google Maps <ArrowUpRight className="size-4" /></a>}
        </div>
    )
}
