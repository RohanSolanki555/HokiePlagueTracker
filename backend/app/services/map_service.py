"""Location/report joins for the map. Coordinates position pins; IDs join reports."""

from collections import Counter
from datetime import datetime, timedelta, timezone
from math import asin, cos, floor, isfinite, radians, sin, sqrt
from zoneinfo import ZoneInfo

from postgrest.exceptions import APIError


CAMPUS_TIMEZONE = ZoneInfo("America/New_York")
PAGE_SIZE = 500
# Home reports are snapped to the centre of a grid cell about 550 m tall before
# they are stored, so neither the database nor the API holds a home position.
HOME_AREA_GRID_DEGREES = 0.005


def blur_to_area(latitude, longitude):
    """Snap a point to its grid cell centre. Deterministic, so repeated reports cannot be averaged."""
    return tuple(
        round((floor(value / HOME_AREA_GRID_DEGREES) + 0.5) * HOME_AREA_GRID_DEGREES, 6)
        for value in (latitude, longitude)
    )


def parse_timestamp(value):
    created_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return created_at.replace(tzinfo=timezone.utc) if created_at.tzinfo is None else created_at


def read_all(build_query):
    """Read every page, even when Supabase's configured row cap is below ours."""
    offset = 0
    while True:
        # PostgREST query builders mutate and append range parameters. Start fresh
        # for each page so an earlier offset cannot survive in the next request.
        rows = build_query().range(offset, offset + PAGE_SIZE - 1).execute().data
        if not rows:
            return
        yield from rows
        offset += len(rows)


def coordinates(location):
    try:
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (isfinite(latitude) and isfinite(longitude)):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def distance_km(latitude, longitude, other_latitude, other_longitude):
    lat1, lat2 = radians(latitude), radians(other_latitude)
    value = (
        sin((lat2 - lat1) / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(radians(other_longitude - longitude) / 2) ** 2
    )
    return 6371.0088 * 2 * asin(sqrt(min(1, max(0, value))))


def read_reports(supabase, since, now, location_ids=None):
    # Bound URL size when filtering many locations, and paginate each batch.
    batches = [None] if location_ids is None else [
        location_ids[index:index + 100] for index in range(0, len(location_ids), 100)
    ]
    for batch in batches:
        def build_query():
            query = (
                supabase.table("reports")
                .select("id,location_id,severity,created_at")
                .gte("created_at", since.isoformat())
                .lte("created_at", now.isoformat())
                .order("id")
            )
            return query if batch is None else query.in_("location_id", batch)
        yield from read_all(build_query)


def read_home_reports(supabase, since, now):
    def build_query():
        return (
            supabase.table("reports")
            .select("id,severity,created_at,area_latitude,area_longitude")
            .eq("residence_type", "home")
            .gte("created_at", since.isoformat())
            .lte("created_at", now.isoformat())
            .order("id")
        )
    yield from read_all(build_query)


def summarize_reports(reports, now, days):
    start = now - timedelta(days=days)
    previous_start = start - timedelta(days=days)
    today = now.astimezone(CAMPUS_TIMEZONE).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    total = previous = reports_today = 0
    severities = []
    latest = None
    for report in reports:
        created_at = parse_timestamp(report["created_at"])
        if created_at > now or created_at < previous_start:
            continue
        if created_at < start:
            previous += 1
            continue
        total += 1
        reports_today += created_at >= today
        if latest is None or created_at > latest:
            latest = created_at
        if report.get("severity") is not None:
            severity = float(report["severity"])
            if isfinite(severity):
                severities.append(severity)
    return {
        "total_reports": total,
        "reports_today": reports_today,
        "previous_period_reports": previous,
        # No finite percentage exists when a nonempty period follows zero reports.
        "change_percent": round((total - previous) / previous * 100, 1)
        if previous else (0 if total == 0 else None),
        "average_severity": round(sum(severities) / len(severities), 2)
        if severities else None,
        "latest_report_at": latest.isoformat() if latest else None,
    }


def save_pinned_location(supabase, metadata):
    """Insert a pinned location, or return the existing row for the same Google place."""
    place_id = metadata.get("place_id")

    def existing_location():
        return (
            supabase.table("locations").select("*").eq("place_id", place_id).limit(1).execute().data
        )

    def reuse_location(location):
        # Legacy rows can have a place ID before they have usable coordinates.
        # Repair invalid pairs together; preserve valid saved positions and names.
        if coordinates(location) is None:
            if coordinates(metadata) is None:
                raise ValueError("The resolved place has no valid coordinates")
            updates = {field: metadata[field] for field in ("latitude", "longitude")}
            saved = (
                supabase.table("locations").update(updates)
                .eq("id", location["id"]).execute().data
            )
            if not saved or coordinates(saved[0]) is None:
                raise ValueError("The location coordinates could not be confirmed as saved")
            location = saved[0]
        return location, False

    if place_id:
        existing = existing_location()
        if existing:
            return reuse_location(existing[0])

    try:
        return supabase.table("locations").insert(metadata).execute().data[0], True
    except APIError as error:
        if error.code != "23505" or not place_id:
            raise
        # Another report/pin request can create this place after our first read.
        # Reuse that row after the unique place_id constraint rejects our insert.
        existing = existing_location()
        if existing:
            return reuse_location(existing[0])
        raise


def get_map_data(supabase, latitude, longitude, radius_km, days, now=None):
    now = now or datetime.now(timezone.utc)
    locations = []
    unmapped = 0
    def build_locations_query():
        # Only dorms are clickable. Other saved locations (including any created
        # from a street address in older versions) are never sent to the map.
        return supabase.table("locations").select(
            "id,name,location_type,latitude,longitude,floors"
        ).eq("is_dorm", True).order("id")

    for row in read_all(build_locations_query):
        point = coordinates(row)
        if point is None:
            unmapped += 1
            continue
        distance = distance_km(latitude, longitude, *point)
        if distance <= radius_km:
            locations.append({
                **row,
                "latitude": point[0],
                "longitude": point[1],
                "distance_km": round(distance, 3),
            })

    grouped = {location["id"]: [] for location in locations}
    reports = list(read_reports(
        supabase, now - timedelta(days=days * 2), now, list(grouped)
    ))
    for report in reports:
        if report["location_id"] in grouped:
            grouped[report["location_id"]].append(report)
    for location in locations:
        location["stats"] = summarize_reports(grouped[location["id"]], now, days)
    locations.sort(key=lambda location: (location["distance_km"], location["name"]))

    # Home reports contribute to the totals and to anonymous, unclickable cells.
    period_start = now - timedelta(days=days)
    home_reports = []
    cells = Counter()
    for report in read_home_reports(supabase, now - timedelta(days=days * 2), now):
        point = coordinates({"latitude": report["area_latitude"], "longitude": report["area_longitude"]})
        if point is None:
            continue
        point = blur_to_area(*point)
        if distance_km(latitude, longitude, *point) > radius_km:
            continue
        home_reports.append(report)
        created_at = parse_timestamp(report["created_at"])
        if period_start <= created_at <= now:
            cells[point] += 1

    return {
        "center": {"latitude": latitude, "longitude": longitude},
        "radius_km": radius_km,
        "days": days,
        "generated_at": now.isoformat(),
        "locations": locations,
        "home_areas": [
            {"latitude": cell_latitude, "longitude": cell_longitude, "reports": count}
            for (cell_latitude, cell_longitude), count in sorted(cells.items())
        ],
        "summary": summarize_reports(reports + home_reports, now, days),
        "unmapped_locations": unmapped,
    }
