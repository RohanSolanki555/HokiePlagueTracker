"""Per-dorm report statistics. Dorms are locations flagged is_dorm."""

from collections import Counter
from datetime import datetime, timedelta, timezone

from app.services.map_service import (
    CAMPUS_TIMEZONE,
    coordinates,
    parse_timestamp,
    read_all,
    read_reports,
    summarize_reports,
)

DORM_COLUMNS = "id,name,floors,latitude,longitude"


def public_dorm(row):
    point = coordinates(row)
    return {
        "id": row["id"],
        "name": row["name"],
        "floors": row.get("floors"),
        "latitude": point[0] if point else None,
        "longitude": point[1] if point else None,
    }


def average_severity(reports):
    scores = [float(report["severity"]) for report in reports if report.get("severity") is not None]
    return round(sum(scores) / len(scores), 2) if scores else None


def list_dorms(supabase, days, now=None):
    now = now or datetime.now(timezone.utc)
    rows = list(read_all(
        lambda: supabase.table("locations").select(DORM_COLUMNS).eq("is_dorm", True).order("id")
    ))
    grouped = {row["id"]: [] for row in rows}
    for report in read_reports(supabase, now - timedelta(days=days * 2), now, list(grouped)):
        if report["location_id"] in grouped:
            grouped[report["location_id"]].append(report)
    dorms = [
        {**public_dorm(row), "stats": summarize_reports(grouped[row["id"]], now, days)}
        for row in rows
    ]
    dorms.sort(key=lambda dorm: dorm["name"].lower())
    return {"days": days, "generated_at": now.isoformat(), "dorms": dorms}


def get_dorm_detail(supabase, dorm_id, days, now=None):
    """Returns None when the ID is not a dorm."""
    now = now or datetime.now(timezone.utc)
    rows = (
        supabase.table("locations").select(DORM_COLUMNS)
        .eq("id", dorm_id).eq("is_dorm", True).limit(1).execute().data
    )
    if not rows:
        return None
    dorm = public_dorm(rows[0])

    reports = list(read_all(
        lambda: (
            supabase.table("reports")
            .select("id,severity,created_at,illness,floor")
            .eq("location_id", dorm_id)
            .gte("created_at", (now - timedelta(days=days * 2)).isoformat())
            .lte("created_at", now.isoformat())
            .order("id")
        )
    ))

    start = now - timedelta(days=days)
    current = [report for report in reports if start <= parse_timestamp(report["created_at"]) <= now]

    illnesses = Counter(report.get("illness") or "Not specified" for report in current)

    # One bucket per campus-timezone day from the window's first day through today,
    # so the daily counts always add up to stats.total_reports.
    first_day = start.astimezone(CAMPUS_TIMEZONE).date()
    last_day = now.astimezone(CAMPUS_TIMEZONE).date()
    by_day = {first_day + timedelta(days=offset): [] for offset in range((last_day - first_day).days + 1)}
    for report in current:
        by_day[parse_timestamp(report["created_at"]).astimezone(CAMPUS_TIMEZONE).date()].append(report)

    floors = Counter(report["floor"] for report in current if report.get("floor") is not None)
    floor_numbers = range(1, dorm["floors"] + 1) if dorm["floors"] else sorted(floors)

    return {
        "dorm": dorm,
        "days": days,
        "generated_at": now.isoformat(),
        "stats": summarize_reports(reports, now, days),
        "illnesses": [
            {"illness": name, "reports": count}
            for name, count in sorted(illnesses.items(), key=lambda item: (-item[1], item[0]))
        ],
        "daily": [
            {"date": day.isoformat(), "reports": len(day_reports), "average_severity": average_severity(day_reports)}
            for day, day_reports in sorted(by_day.items())
        ],
        "floors": [{"floor": number, "reports": floors.get(number, 0)} for number in floor_numbers],
    }
