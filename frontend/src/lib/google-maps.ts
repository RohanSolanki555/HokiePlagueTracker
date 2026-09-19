import { importLibrary, setOptions } from "@googlemaps/js-api-loader"

export const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
export const mapsMapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID"

let configured = false

export async function loadGoogleMaps() {
    if (!mapsApiKey) throw new Error("Map access has not been configured.")
    if (!configured) {
        setOptions({ key: mapsApiKey, v: "quarterly" })
        configured = true
    }
    const [maps, marker] = await Promise.all([
        importLibrary("maps"),
        importLibrary("marker"),
    ])
    return { maps, marker }
}
