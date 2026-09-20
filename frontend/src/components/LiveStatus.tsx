import { useEffect, useState } from "react"

interface Props {
    updatedAt: number | null
    loading: boolean
    failed: boolean
}

function ago(seconds: number) {
    if (seconds < 5) return "just now"
    if (seconds < 60) return `${seconds}s ago`
    return `${Math.floor(seconds / 60)}m ago`
}

// Ticks on its own once a second so the rest of the dashboard does not re-render with it.
export default function LiveStatus({ updatedAt, loading, failed }: Props) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [])

    const state = failed ? "error" : loading ? "loading" : "live"
    const seconds = updatedAt === null ? 0 : Math.max(0, Math.floor((now - updatedAt) / 1000))
    const label = failed ? "Connection lost · retrying"
        : loading && updatedAt === null ? "Connecting…"
            : loading ? "Refreshing…"
                : `Live · updated ${ago(seconds)}`

    return (
        <p className="dash-live" data-state={state}>
            <span className="dash-live-dot" aria-hidden="true" /> {label}
        </p>
    )
}
