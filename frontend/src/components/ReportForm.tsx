import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type CreateReportResponse } from "@/services/api"

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

interface Props {
    onSubmitted?: (result: CreateReportResponse) => void
}

export default function ReportForm({ onSubmitted }: Props) {
    const [address, setAddress] = useState("")
    const [illness, setIllness] = useState("")
    const [fluType, setFluType] = useState<"" | "A" | "B">("")
    const [severity, setSeverity] = useState("3")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState<CreateReportResponse | null>(null)

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return
        setError("")
        setSuccess(null)
        if (!address.trim() || !illness.trim()) {
            setError("Enter your address and select an illness.")
            return
        }
        setSubmitting(true)
        try {
            const saved = await api.createReport({
                address: `${address.trim()}${ADDRESS_SUFFIX}`,
                illness: illness.trim(),
                flu_type: illness === "Flu" && fluType ? fluType : undefined,
                severity: Number(severity),
            })
            setAddress("")
            setIllness("")
            setFluType("")
            setSeverity("3")
            setSuccess(saved)
            onSubmitted?.(saved)
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
                        Choose an illness and enter its location. Your address becomes a shared map pin, and your report adds to its count.
                    </p>
                    <fieldset disabled={submitting} className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                            <label htmlFor="report-address" className="text-sm font-medium">Street address</label>
                            <div className="flex items-center gap-2">
                                <Input id="report-address" name="address" autoComplete="address-line1"
                                    placeholder="225 Stanger St" aria-describedby="report-city"
                                    required maxLength={500 - ADDRESS_SUFFIX.length} value={address}
                                    onChange={(event) => setAddress(event.target.value)} />
                                <span id="report-city" className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">Blacksburg, VA</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="report-illness" className="text-sm font-medium">Illness</label>
                            <select id="report-illness" name="illness" required value={illness}
                                onChange={(event) => {
                                    setIllness(event.target.value)
                                    setFluType("")
                                }}
                                className="block h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
                                <option value="" disabled>Select an illness</option>
                                {illnesses.map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </div>
                        {illness === "Flu" && (
                            <div className="space-y-2">
                                <label htmlFor="report-flu-type" className="text-sm font-medium">Flu type (optional)</label>
                                <select id="report-flu-type" name="flu_type" value={fluType}
                                    onChange={(event) => setFluType(event.target.value as "" | "A" | "B")}
                                    className="block h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
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
                                className="block h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
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
                        <p role="status" className="text-sm">Your report was saved for {success.location.name}.</p>
                        {!onSubmitted && <a
                            className="text-sm font-medium text-[#861f41] underline underline-offset-4"
                            href={`/?${new URLSearchParams({
                                latitude: String(success.location.latitude),
                                longitude: String(success.location.longitude),
                                location_id: String(success.location.id),
                            })}`}
                        >View report on map</a>}
                    </div>}
                </form>
            </CardContent>
        </Card>
    )
}
