import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/services/api"

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

export default function ReportForm() {
    const [address, setAddress] = useState("")
    const [illness, setIllness] = useState("")
    const [fluType, setFluType] = useState<"" | "A" | "B">("")
    const [severity, setSeverity] = useState("3")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState(false)

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return
        setError("")
        setSuccess(false)
        if (!address.trim() || !illness.trim()) {
            setError("Enter your address and select an illness.")
            return
        }
        setSubmitting(true)
        try {
            await api.createReport({
                address: address.trim(),
                illness: illness.trim(),
                flu_type: illness === "Flu" && fluType ? fluType : undefined,
                severity: Number(severity),
            })
            setAddress("")
            setIllness("")
            setFluType("")
            setSeverity("3")
            setSuccess(true)
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
                <form onSubmit={submit} className="max-w-xl space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Share where you are experiencing illness. Your address is stored with your report and is not shown on the dashboard.
                    </p>
                    <fieldset disabled={submitting} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="report-address" className="text-sm font-medium">Address</label>
                            <Input id="report-address" name="address" autoComplete="street-address"
                                placeholder="Street address, city, state, ZIP code"
                                required maxLength={500} value={address}
                                onChange={(event) => setAddress(event.target.value)} />
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
                        <Button type="submit" disabled={submitting}>
                            {submitting ? "Submitting…" : "Submit report"}
                        </Button>
                    </fieldset>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    {success && <p role="status" className="text-sm">Your report was saved. Thank you for sharing.</p>}
                </form>
            </CardContent>
        </Card>
    )
}
