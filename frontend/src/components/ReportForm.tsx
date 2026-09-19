import { useEffect, useState, type FormEvent } from "react"
import { ArrowRight, Building2, CheckCircle2, CircleAlert, House, LoaderCircle, MapPin, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, type CreateReportRequest, type DormSummary } from "@/services/api"

const ADDRESS_SUFFIX = ", Blacksburg, VA"

const illnesses = [
    "Common cold",
    "COVID-19",
    "Flu",
    "Strep throat",
    "Mononucleosis (mono)",
    "Norovirus",
    "Stomach bug",
    "RSV",
    "Pink eye (conjunctivitis)",
    "Sinus infection",
    "Other",
]

export interface SubmittedReport {
    dormId: number | null
}

interface Props {
    onSubmitted?: (result: SubmittedReport) => void
}

export default function ReportForm({ onSubmitted }: Props) {
    const [residence, setResidence] = useState<"dorm" | "home">("dorm")
    const [dorms, setDorms] = useState<DormSummary[]>([])
    const [dormsError, setDormsError] = useState(false)
    const [dormId, setDormId] = useState("")
    const [floor, setFloor] = useState("")
    const [address, setAddress] = useState("")
    const [illness, setIllness] = useState("")
    const [fluType, setFluType] = useState<"" | "A" | "B">("")
    const [severity, setSeverity] = useState("3")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState("")

    useEffect(() => {
        const controller = new AbortController()
        api.getDorms(7, controller.signal).then((data) => {
            if (!controller.signal.aborted) setDorms(data.dorms)
        }).catch(() => {
            if (!controller.signal.aborted) setDormsError(true)
        })
        return () => controller.abort()
    }, [])

    const selectedDorm = dorms.find((dorm) => String(dorm.id) === dormId)

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return
        setError("")
        setSuccess("")
        if (!illness.trim()) {
            setError("Select an illness.")
            return
        }
        let where: { residence_type: "dorm"; dorm_id: number; floor: number } | { residence_type: "home"; address: string }
        if (residence === "dorm") {
            if (!selectedDorm || !floor) {
                setError("Select your dorm and floor.")
                return
            }
            where = { residence_type: "dorm", dorm_id: selectedDorm.id, floor: Number(floor) }
        } else {
            if (!address.trim()) {
                setError("Enter your address.")
                return
            }
            where = { residence_type: "home", address: `${address.trim()}${ADDRESS_SUFFIX}` }
        }
        const report: CreateReportRequest = {
            ...where,
            illness: illness.trim(),
            flu_type: illness === "Flu" && fluType ? fluType : undefined,
            severity: Number(severity),
        }
        setSubmitting(true)
        try {
            await api.createReport(report)
            const savedDormId = where.residence_type === "dorm" ? where.dorm_id : null
            setAddress("")
            setIllness("")
            setFluType("")
            setSeverity("3")
            setSuccess(selectedDorm && savedDormId !== null
                ? `Your report was saved for ${selectedDorm.name}.`
                : "Your report was saved. It appears on the map only as an approximate area.")
            onSubmitted?.({ dormId: savedDormId })
        } catch (error) {
            setError(error instanceof Error ? error.message : "Unable to save your report.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <section className="dash-panel dash-report" aria-labelledby="report-title">
            <span className="dash-label">Help your fellow Hokies</span>
            <h2 className="dash-panel-title" id="report-title">Report an illness</h2>
            <p className="dash-panel-desc">Dorm reports count toward your dorm's statistics.</p>

            <form onSubmit={submit} className="dash-report-form" aria-busy={submitting}>
                <fieldset disabled={submitting} className="dash-form-fields">
                    <div className="dash-field dash-span">
                        <span id="report-residence-label" className="dash-field-label">Where are you staying?</span>
                        <div role="radiogroup" aria-labelledby="report-residence-label" className="dash-segment">
                            <label className="dash-segment-option">
                                <input type="radio" name="residence" value="dorm" checked={residence === "dorm"} onChange={() => setResidence("dorm")} />
                                <Building2 aria-hidden="true" />
                                On-campus dorm
                            </label>
                            <label className="dash-segment-option">
                                <input type="radio" name="residence" value="home" checked={residence === "home"} onChange={() => setResidence("home")} />
                                <House aria-hidden="true" />
                                Off campus
                            </label>
                        </div>
                    </div>

                    {residence === "dorm" ? <>
                        <div className="dash-field">
                            <label htmlFor="report-dorm">Dorm</label>
                            <select id="report-dorm" name="dorm_id" required value={dormId} className="dash-select"
                                onChange={(event) => { setDormId(event.target.value); setFloor("") }}>
                                <option value="" disabled>{dormsError ? "Dorms could not load" : dorms.length ? "Select your dorm" : "Loading dorms…"}</option>
                                {dorms.map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name}</option>)}
                            </select>
                        </div>
                        <div className="dash-field">
                            <label htmlFor="report-floor">Floor</label>
                            {selectedDorm && !selectedDorm.floors
                                ? <Input id="report-floor" name="floor" type="number" min={1} max={60} step={1} required value={floor} className="dash-input"
                                    onChange={(event) => setFloor(event.target.value)} />
                                : <select id="report-floor" name="floor" required value={floor} disabled={!selectedDorm} className="dash-select"
                                    onChange={(event) => setFloor(event.target.value)}>
                                    <option value="" disabled>Select floor</option>
                                    {Array.from({ length: selectedDorm?.floors ?? 0 }, (_, index) => index + 1)
                                        .map((number) => <option key={number} value={number}>Floor {number}</option>)}
                                </select>}
                        </div>
                    </> : (
                        <div className="dash-field dash-span">
                            <label htmlFor="report-address">Street address</label>
                            <div className="dash-input-wrap dash-input-wrap-suffix">
                                <MapPin className="dash-input-icon" aria-hidden="true" />
                                <Input id="report-address" name="address" autoComplete="address-line1" className="dash-input"
                                    placeholder="225 Stanger St" aria-describedby="report-city"
                                    required maxLength={500 - ADDRESS_SUFFIX.length} value={address}
                                    onChange={(event) => setAddress(event.target.value)} />
                                <span id="report-city" className="dash-input-suffix">Blacksburg, VA</span>
                            </div>
                        </div>
                    )}

                    <div className="dash-field dash-span">
                        <label htmlFor="report-illness">Illness</label>
                        <select id="report-illness" name="illness" required value={illness} className="dash-select"
                            onChange={(event) => {
                                setIllness(event.target.value)
                                setFluType("")
                            }}>
                            <option value="" disabled>Select an illness</option>
                            {illnesses.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </div>
                    {illness === "Flu" && (
                        <div className="dash-field dash-span">
                            <label htmlFor="report-flu-type">Flu type (optional)</label>
                            <select id="report-flu-type" name="flu_type" value={fluType} className="dash-select"
                                onChange={(event) => setFluType(event.target.value as "" | "A" | "B")}>
                                <option value="">Not sure / unspecified</option>
                                <option value="A">Flu A</option>
                                <option value="B">Flu B</option>
                            </select>
                        </div>
                    )}
                    <div className="dash-field dash-span">
                        <label htmlFor="report-severity">Severity</label>
                        <select id="report-severity" name="severity" value={severity} className="dash-select"
                            onChange={(event) => setSeverity(event.target.value)}>
                            <option value="1">1 — Very mild</option>
                            <option value="2">2 — Mild</option>
                            <option value="3">3 — Moderate</option>
                            <option value="4">4 — Severe</option>
                            <option value="5">5 — Very severe</option>
                        </select>
                    </div>

                    <Button type="submit" disabled={submitting} className="dash-submit dash-span">
                        <span>{submitting ? "Submitting..." : "Submit report"}</span>
                        {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                    </Button>
                </fieldset>

                {error && <div role="alert" className="dash-feedback"><CircleAlert aria-hidden="true" /><p>{error}</p></div>}
                {success && <div role="status" className="dash-feedback dash-feedback-success"><CheckCircle2 aria-hidden="true" /><p>{success}</p></div>}
            </form>

            <p className="dash-report-note">
                <ShieldCheck aria-hidden="true" />
                <span>Off-campus addresses are used once to find your general area, are never stored, and appear on the map only as an unclickable approximate dot.</span>
            </p>
        </section>
    )
}
