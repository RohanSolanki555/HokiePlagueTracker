"""Illness counts across all reports, independent of map position or residence."""

from collections import Counter
from datetime import datetime, timedelta, timezone

from app.services.map_service import parse_timestamp, read_all, summarize_reports


def get_illness_summary(supabase, days, now=None):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days is not None else None
    previous_since = since - timedelta(days=days) if since is not None else None

    def build_query():
        query = (
            supabase.table("reports")
            .select("illness,created_at,severity")
            .lte("created_at", now.isoformat())
            .order("id")
        )
        return query if previous_since is None else query.gte("created_at", previous_since.isoformat())

    reports = list(read_all(build_query))
    stats = summarize_reports(reports, now, days)
    counts = Counter()
    for report in reports:
        created_at = parse_timestamp(report["created_at"])
        if created_at > now or (since is not None and created_at < since):
            continue
        illness = (report.get("illness") or "").strip() or "Not specified"
        counts[illness] += 1

    return {
        "days": days if days is not None else "all",
        "generated_at": now.isoformat(),
        "total_reports": stats["total_reports"],
        "stats": stats,
        "illnesses": [
            {"illness": illness, "reports": count}
            for illness, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ],
    }
