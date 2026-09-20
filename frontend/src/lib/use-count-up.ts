import { useEffect, useRef, useState } from "react"

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Eases the shown number toward `target` (from the last value shown), so refreshed counts tick up or
// down instead of jumping. Returns null until there is a target.
export function useCountUp(target: number | null | undefined, duration = 700) {
    const shown = useRef(0) // Only read inside effects: the value on screen when a new tween starts.
    const [tween, setTween] = useState<{ to: number; value: number } | null>(null)

    useEffect(() => {
        if (target === null || target === undefined) return
        const from = shown.current
        let frame = 0
        if (from === target || prefersReducedMotion()) {
            shown.current = target
            frame = requestAnimationFrame(() => setTween({ to: target, value: target }))
            return () => cancelAnimationFrame(frame)
        }
        const start = performance.now()
        const step = (now: number) => {
            const progress = Math.min(1, (now - start) / duration)
            const value = progress === 1 ? target : from + (target - from) * (1 - Math.pow(1 - progress, 3))
            shown.current = value
            setTween({ to: target, value })
            if (progress < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
    }, [target, duration])

    if (target === null || target === undefined) return null
    if (prefersReducedMotion()) return target
    // Until the first frame of a new tween, keep showing the previous number (0 on first load).
    return tween?.to === target ? tween.value : tween?.value ?? 0
}
