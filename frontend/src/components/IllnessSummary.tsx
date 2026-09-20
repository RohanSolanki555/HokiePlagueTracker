import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, type IllnessSummaryResponse, type ReportPeriod } from "@/services/api"

interface Props {
    days: ReportPeriod
    refresh: number
}

const percentage = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

export default function IllnessSummary({ days, refresh }: Props) {
    const [retry, setRetry] = useState(0)
    const [result, setResult] = useState<{
        days: ReportPeriod
        refresh: number
        retry: number
        data: IllnessSummaryResponse | null
        error: string | null
    } | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        api.getIllnessSummary(days, controller.signal).then((data) => {
            if (!controller.signal.aborted) setResult({ days, refresh, retry, data, error: null })
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setResult({
                days, refresh, retry, data: null,
                error: reason instanceof Error ? reason.message : "Illness reports could not load.",
            })
        })
        return () => controller.abort()
    }, [days, refresh, retry])

    // Preserve counts during a refresh, but never show an old period under a new label.
    const data = result?.days === days ? result.data : null
    const loading = result?.days !== days || result?.refresh !== refresh || result?.retry !== retry
    const error = loading ? null : result?.error

    return (
        <section className="dash-panel dash-illnesses" aria-labelledby="illness-summary-title" aria-busy={loading}>
            <div className="dash-illnesses-head">
                <div>
                    <span className="dash-label">Community snapshot</span>
                    <h2 id="illness-summary-title" className="dash-panel-title">Illness reports in Blacksburg</h2>
                    <p className="dash-panel-desc">Self-reported illnesses across the tracker, including dorms and off-campus homes.</p>
                </div>
                <div className="dash-illnesses-total">
                    <span className="dash-illnesses-period">{days === "all" ? "All time" : `Last ${days} days`}</span>
                    <p>{data ? <><strong>{data.total_reports.toLocaleString()}</strong> {data.total_reports === 1 ? "report" : "reports"}</> : loading ? "Loading reports…" : "Summary unavailable"}</p>
                </div>
            </div>

            {error && <div role="alert" className="dash-feedback dash-feedback-action">
                <span>{error}</span>
                <Button variant="outline" className="dash-btn-outline" onClick={() => setRetry((value) => value + 1)}>Retry illness summary</Button>
            </div>}

            {data && (data.illnesses.length ? <ul className="dash-illness-list">
                {data.illnesses.map(({ illness, reports }) => {
                    const share = data.total_reports > 0 ? reports / data.total_reports * 100 : 0
                    return <li key={illness} className="dash-illness-item">
                        <div className="dash-illness-label"><span>{illness}</span><span className="dash-illness-share">{percentage.format(share)}%</span></div>
                        <p className="dash-illness-count">{reports.toLocaleString()} {reports === 1 ? "report" : "reports"}</p>
                        <div className="dash-illness-track" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
                    </li>
                })}
            </ul> : <p className="dash-empty-line" role="status">No illness reports for this period.</p>)}

            <p className="dash-illnesses-note">Percentages show the share of submitted reports, not the share of residents. The report period below applies here; the map radius does not.</p>
        </section>
    )
}
