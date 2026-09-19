import { useEffect, useRef, useState } from "react"
import { MapPin, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { loadGoogleMaps, mapsApiKey, mapsMapId } from "@/lib/google-maps"
import type { HomeArea, MapLocation, MapQuery } from "@/services/api"

interface Props {
    query: MapQuery
    locations: MapLocation[]
    homeAreas: HomeArea[]
    selectedId: number | null
    onSelect: (id: number) => void
}

type Runtime = Awaited<ReturnType<typeof loadGoogleMaps>> & { map: google.maps.Map }

export default function LocationMap({ query, locations, homeAreas, selectedId, onSelect }: Props) {
    const container = useRef<HTMLDivElement>(null)
    const initialCenter = useRef({ lat: query.latitude, lng: query.longitude })
    const [runtime, setRuntime] = useState<Runtime | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!mapsApiKey) return
        let disposed = false
        let unauthorized = false
        let map: google.maps.Map | undefined
        const mapsWindow = window as typeof window & { gm_authFailure?: () => void }
        const previousAuthFailure = mapsWindow.gm_authFailure
        const authFailure = () => {
            unauthorized = true
            if (!disposed) setError("Google Maps could not authorize this map. Please check map access and reload.")
        }
        mapsWindow.gm_authFailure = authFailure
        const timer = window.setTimeout(() => {
            if (!disposed) setError("Google Maps is taking too long to load. Check your connection and reload.")
        }, 20000)

        loadGoogleMaps().then((libraries) => {
            if (disposed || !container.current) return
            if (!unauthorized) setError(null)
            map = new libraries.maps.Map(container.current, {
                mapId: mapsMapId,
                center: initialCenter.current,
                zoom: 14,
                mapTypeControl: false,
                streetViewControl: false,
                gestureHandling: "cooperative",
            })
            setRuntime({ ...libraries, map })
        }).catch(() => {
            if (!disposed) setError("Google Maps could not load. Check your connection and reload.")
        }).finally(() => window.clearTimeout(timer))

        return () => {
            disposed = true
            window.clearTimeout(timer)
            if (mapsWindow.gm_authFailure === authFailure) mapsWindow.gm_authFailure = previousAuthFailure
            if (map) google.maps.event.clearInstanceListeners(map)
        }
    }, [])

    useEffect(() => {
        if (!runtime) return
        const center = { lat: query.latitude, lng: query.longitude }
        const circle = new runtime.maps.Circle({
            map: runtime.map, center, radius: query.radius_km * 1000,
            fillColor: "#801036", fillOpacity: 0.06,
            strokeColor: "#801036", strokeOpacity: 0.6, strokeWeight: 1.5,
            clickable: false,
        })
        const bounds = circle.getBounds()
        if (bounds) runtime.map.fitBounds(bounds, 35)
        const centerPin = new runtime.marker.AdvancedMarkerElement({
            map: runtime.map, position: center, title: "Drillfield", zIndex: 0,
        })
        centerPin.append(new runtime.marker.PinElement({
            background: "#ffffff", borderColor: "#52525b", glyphColor: "#52525b", glyphText: "+",
        }))
        return () => {
            circle.setMap(null)
            centerPin.map = null
        }
    }, [runtime, query.latitude, query.longitude, query.radius_km])

    useEffect(() => {
        if (!runtime) return
        // A dorm only gets a pin once it has a report in the current period; it stays in the list either way.
        const markers = locations.filter((location) => location.stats.total_reports > 0).map((location) => {
            const selected = location.id === selectedId
            const marker = new runtime.marker.AdvancedMarkerElement({
                map: runtime.map,
                position: { lat: location.latitude, lng: location.longitude },
                title: `${location.name}: ${location.stats.total_reports} reports`,
                zIndex: selected ? 1000 : 1,
                gmpClickable: true,
            })
            marker.append(new runtime.marker.PinElement({
                background: selected ? "#ef620f" : "#801036",
                borderColor: selected ? "#a64108" : "#5a0b26", glyphColor: "#ffffff",
                glyphText: String(location.stats.total_reports), scale: selected ? 1.2 : 1,
            }))
            const listener = () => onSelect(location.id)
            marker.addEventListener("gmp-click", listener)
            return { marker, listener }
        })
        return () => markers.forEach(({ marker, listener }) => {
            marker.removeEventListener("gmp-click", listener)
            marker.map = null
        })
    }, [runtime, locations, selectedId, onSelect])

    useEffect(() => {
        if (!runtime) return
        // Off-campus home reports: approximate cells only. No title, no click handling, and
        // pointer events off, so nothing about them can be selected or inspected.
        const markers = homeAreas.map((area) => {
            const marker = new runtime.marker.AdvancedMarkerElement({
                map: runtime.map,
                position: { lat: area.latitude, lng: area.longitude },
                zIndex: 0,
                gmpClickable: false,
            })
            marker.style.pointerEvents = "none"
            marker.setAttribute("aria-hidden", "true")
            marker.append(new runtime.marker.PinElement({
                background: "#e87722", borderColor: "#a84b08", glyphColor: "#e87722", scale: 0.7,
            }))
            return marker
        })
        return () => markers.forEach((marker) => { marker.map = null })
    }, [runtime, homeAreas])

    const unavailable = !mapsApiKey || error

    return (
        <div className="dash-map">
            <div ref={container} className="dash-map-canvas" aria-label="Map of nearby report locations" />
            {unavailable ? (
                <div className="dash-map-fallback" role="status">
                    <span className="dash-map-fallback-icon"><MapPin aria-hidden="true" /></span>
                    <h3>Map unavailable</h3>
                    <p>{error || "Map access has not been configured."} Location statistics are still available below.</p>
                    {error && <Button variant="outline" className="dash-btn-outline" onClick={() => window.location.reload()}>Reload map</Button>}
                </div>
            ) : !runtime ? (
                <div className="dash-map-fallback dash-map-loading" role="status">Loading Google Maps…</div>
            ) : (
                <Button className="dash-search-area" onClick={() => {
                    runtime.map.setCenter({ lat: query.latitude, lng: query.longitude })
                }}><LocateFixed aria-hidden="true" /> Center on Drillfield</Button>
            )}
        </div>
    )
}
