import { Button } from "@/components/ui/button"
import { type IllnessSummaryResponse, type ReportPeriod } from "@/services/api"

interface Props {
    days: ReportPeriod
    data: IllnessSummaryResponse | null
    loading: boolean
    error: string | null
    onRetry: () => void
}

const percentage = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

export default function IllnessSummary({ days, data, loading, error, onRetry }: Props) {
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
                <Button variant="outline" className="dash-btn-outline" onClick={onRetry}>Retry illness summary</Button>
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

            <p className="dash-illnesses-note">Percentages show the share of submitted reports, not the share of residents. These counts and the cards above use all reports in the selected period. The radius only filters the map.</p>
        </section>
    )
}
