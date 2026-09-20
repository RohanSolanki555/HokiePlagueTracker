import { supabase } from "./auth"

const API_URL = (
    import.meta.env.VITE_API_URL ??
    "http://localhost:5000/api"
).replace(/\/$/, "")


async function request<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    const response = await fetch(
        `${API_URL}${endpoint}`,
        {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
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
        request<CreateReportResponse>("/reports", {
            method: "POST",
            body: JSON.stringify(report),
        }),

    getLocations: () =>
        request<Location[]>("/locations"),

    getSummary: () =>
        request<Summary>("/stats/summary"),

    getIllnessSummary: (days: ReportPeriod, signal?: AbortSignal) =>
        request<IllnessSummaryResponse>(`/stats/illnesses?days=${days}`, { signal }),

    getDorms: (days: ReportPeriod, signal?: AbortSignal) =>
        request<DormListResponse>(`/dorms?days=${days}`, { signal }),

    getDorm: (id: number, days: ReportPeriod, signal?: AbortSignal) =>
        request<DormDetail>(`/dorms/${id}?days=${days}`, { signal }),

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
    location_id: number | null
    severity: number
    created_at: string
}

export type CreateReportRequest = (
    | { residence_type: "dorm"; dorm_id: number; floor: number }
    | { residence_type: "home"; address: string }
) & {
    illness: string
    flu_type?: "A" | "B"
    severity: number
}

export interface Location {
    id: number
    name: string
    location_type: string
    latitude: number | null
    longitude: number | null
}

export interface CreateReportResponse {
    report: Report
}

export interface Summary {
    reports_today: number
    reports_this_week: number
    weekly_change: number | null
}

export type ReportPeriod = number | "all"

export interface IllnessSummaryResponse {
    days: ReportPeriod
    generated_at: string
    total_reports: number
    stats: LocationStatistics
    illnesses: { illness: string; reports: number }[]
}

export interface MapQuery {
    latitude: number
    longitude: number
    radius_km: number
    days: ReportPeriod
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
    floors: number | null
    distance_km: number
    stats: LocationStatistics
}

// An approximate ~500 m cell holding off-campus home reports. It carries no name, ID or address.
export interface HomeArea {
    latitude: number
    longitude: number
    reports: number
}

export interface Dorm {
    id: number
    name: string
    floors: number | null
    latitude: number | null
    longitude: number | null
}

export interface DormSummary extends Dorm {
    stats: LocationStatistics
}

export interface DormListResponse {
    days: ReportPeriod
    generated_at: string
    dorms: DormSummary[]
}

export interface DormDetail {
    dorm: Dorm
    days: ReportPeriod
    generated_at: string
    stats: LocationStatistics
    illnesses: { illness: string; reports: number }[]
    daily: { date: string; reports: number; average_severity: number | null }[]
    floors: { floor: number; reports: number }[]
}

export interface LocationMapResponse {
    center: { latitude: number; longitude: number }
    radius_km: number
    days: ReportPeriod
    generated_at: string
    locations: MapLocation[]
    home_areas: HomeArea[]
    summary: LocationStatistics
    unmapped_locations: number
}
