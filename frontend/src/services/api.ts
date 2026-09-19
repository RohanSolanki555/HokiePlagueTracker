const API_URL = (
    import.meta.env.VITE_API_URL ??
    "http://localhost:5000/api"
).replace(/\/$/, "")


async function request<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const response = await fetch(
        `${API_URL}${endpoint}`,
        {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options?.headers,
            },
        }
    )

    if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? `API request failed: ${response.status}`)
    }

    return response.json()
}


export const api = {
    health: () =>
        request<HealthResponse>("/health"),

    getReports: () =>
        request<Report[]>("/reports"),

    createReport: (report: CreateReportRequest) =>
        request<Report[]>("/reports", {
            method: "POST",
            body: JSON.stringify(report),
        }),

    getLocations: () =>
        request<Location[]>("/locations"),

    getSummary: () =>
        request<Summary>("/stats/summary"),

    getLocationMap: (query: MapQuery, signal?: AbortSignal) => {
        const params = new URLSearchParams({
            latitude: String(query.latitude),
            longitude: String(query.longitude),
            radius_km: String(query.radius_km),
            days: String(query.days),
        })
        return request<LocationMapResponse>(`/locations/map?${params}`, { signal })
    },
}


export interface HealthResponse {
    status: string
    service: string
}

export interface Report {
    id: number
    location_id: number
    severity: number
    created_at: string
}

export interface CreateReportRequest {
    location_id: number
    severity: number
}

export interface Location {
    id: number
    name: string
    location_type: string
    latitude: number | null
    longitude: number | null
}

export interface Summary {
    reports_today: number
    reports_this_week: number
    weekly_change: number | null
}

export interface MapQuery {
    latitude: number
    longitude: number
    radius_km: number
    days: number
}

export interface LocationStatistics {
    total_reports: number
    reports_today: number
    previous_period_reports: number
    change_percent: number | null
    average_severity: number | null
    latest_report_at: string | null
}

export interface MapLocation extends Location {
    latitude: number
    longitude: number
    distance_km: number
    stats: LocationStatistics
}

export interface LocationMapResponse {
    center: { latitude: number; longitude: number }
    radius_km: number
    days: number
    generated_at: string
    locations: MapLocation[]
    summary: LocationStatistics
    unmapped_locations: number
}
