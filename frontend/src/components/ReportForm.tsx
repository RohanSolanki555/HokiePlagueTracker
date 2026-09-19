import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type CreateReportRequest, type DormSummary } from "@/services/api"

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

const selectClass = "block h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"

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
    const [success, setSuccess] = useState<{ message: string; dormId: number | null } | null>(null)

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
        setSuccess(null)
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
            where = { residence_type: "home", address: address.trim() }
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
            setSuccess({
                message: selectedDorm && savedDormId !== null
                    ? `Your report was saved for ${selectedDorm.name}.`
                    : "Your report was saved. It appears on the map only as an approximate area.",
                dormId: savedDormId,
            })
            onSubmitted?.({ dormId: savedDormId })
        } catch (error) {
            setError(error instanceof Error ? error.message : "Unable to save your report.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Report an illness</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4" aria-busy={submitting}>
                    <p className="text-sm text-muted-foreground">
                        Dorm reports count toward your dorm's statistics. Off-campus addresses are used once to find your general area, are never stored, and appear on the map only as an unclickable approximate dot.
                    </p>
                    <fieldset disabled={submitting} className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                            <span id="report-residence-label" className="text-sm font-medium">Where are you staying?</span>
                            <div role="radiogroup" aria-labelledby="report-residence-label" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="residence" value="dorm" checked={residence === "dorm"} onChange={() => setResidence("dorm")} />
                                    On-campus dorm
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="radio" name="residence" value="home" checked={residence === "home"} onChange={() => setResidence("home")} />
                                    Off campus
                                </label>
                            </div>
                        </div>
                        {residence === "dorm" ? <>
                            <div className="space-y-2">
                                <label htmlFor="report-dorm" className="text-sm font-medium">Dorm</label>
                                <select id="report-dorm" name="dorm_id" required value={dormId} className={selectClass}
                                    onChange={(event) => { setDormId(event.target.value); setFloor("") }}>
                                    <option value="" disabled>{dormsError ? "Dorms could not load" : dorms.length ? "Select your dorm" : "Loading dorms…"}</option>
                                    {dorms.map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="report-floor" className="text-sm font-medium">Floor</label>
                                {selectedDorm && !selectedDorm.floors
                                    ? <Input id="report-floor" name="floor" type="number" min={1} max={60} step={1} required value={floor}
                                        onChange={(event) => setFloor(event.target.value)} />
                                    : <select id="report-floor" name="floor" required value={floor} disabled={!selectedDorm} className={selectClass}
                                        onChange={(event) => setFloor(event.target.value)}>
                                        <option value="" disabled>{selectedDorm ? "Select your floor" : "Choose a dorm first"}</option>
                                        {Array.from({ length: selectedDorm?.floors ?? 0 }, (_, index) => index + 1)
                                            .map((number) => <option key={number} value={number}>Floor {number}</option>)}
                                    </select>}
                            </div>
                        </> : (
                            <div className="space-y-2 sm:col-span-2">
                                <label htmlFor="report-address" className="text-sm font-medium">Street address</label>
                                <Input id="report-address" name="address" autoComplete="street-address"
                                    placeholder="225 Stanger St, Blacksburg, VA"
                                    required maxLength={500} value={address}
                                    onChange={(event) => setAddress(event.target.value)} />
                            </div>
                        )}
                        <div className="space-y-2">
                            <label htmlFor="report-illness" className="text-sm font-medium">Illness</label>
                            <select id="report-illness" name="illness" required value={illness}
                                onChange={(event) => {
                                    setIllness(event.target.value)
                                    setFluType("")
                                }}
                                className={selectClass}>
                                <option value="" disabled>Select an illness</option>
                                {illnesses.map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </div>
                        {illness === "Flu" && (
                            <div className="space-y-2">
                                <label htmlFor="report-flu-type" className="text-sm font-medium">Flu type (optional)</label>
                                <select id="report-flu-type" name="flu_type" value={fluType}
                                    onChange={(event) => setFluType(event.target.value as "" | "A" | "B")}
                                    className={selectClass}>
                                    <option value="">Not sure / unspecified</option>
                                    <option value="A">Flu A</option>
                                    <option value="B">Flu B</option>
                                </select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <label htmlFor="report-severity" className="text-sm font-medium">Severity</label>
                            <select id="report-severity" name="severity" value={severity}
                                onChange={(event) => setSeverity(event.target.value)}
                                className={selectClass}>
                                <option value="1">1 — Very mild</option>
                                <option value="2">2 — Mild</option>
                                <option value="3">3 — Moderate</option>
                                <option value="4">4 — Severe</option>
                                <option value="5">5 — Very severe</option>
                            </select>
                        </div>
                        <Button type="submit" disabled={submitting} className="bg-[#861f41] hover:bg-[#6b1934] sm:col-span-2 sm:justify-self-start">
                            {submitting ? "Submitting..." : "Submit report"}
                        </Button>
                    </fieldset>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    {success && <div className="space-y-2">
                        <p role="status" className="text-sm">{success.message}</p>
                        {!onSubmitted && success.dormId !== null && <a
                            className="text-sm font-medium text-[#861f41] underline underline-offset-4"
                            href={`/?location_id=${success.dormId}`}
                        >View dorm on the dashboard</a>}
                    </div>}
                </form>
            </CardContent>
        </Card>
    )
}
