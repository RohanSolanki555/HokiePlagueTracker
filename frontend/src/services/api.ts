const API_URL =
    import.meta.env.VITE_API_URL ??
    "http://localhost:5000/api"


async function request<T>(
    endpoint: string,
    options?: RequestInit
): Promise<T> {
    const response = await fetch(
        `${API_URL}${endpoint}`,
        {
            headers: {
                "Content-Type": "application/json",
                ...options?.headers,
            },
            ...options,
        }
    )

    if (!response.ok) {
        throw new Error(
            `API request failed: ${response.status}`
        )
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
}

export interface Summary {
    reports_today: number
    reports_this_week: number
    weekly_change: number
}