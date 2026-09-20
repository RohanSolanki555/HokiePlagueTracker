"""Illness counts across all reports, independent of map position or residence."""

from collections import Counter
from datetime import datetime, timedelta, timezone

from app.services.map_service import parse_timestamp, read_all


def get_illness_summary(supabase, days, now=None):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days is not None else None

    def build_query():
        query = (
            supabase.table("reports")
            .select("illness,created_at")
            .lte("created_at", now.isoformat())
            .order("id")
        )
        return query if since is None else query.gte("created_at", since.isoformat())

    counts = Counter()
    for report in read_all(build_query):
        created_at = parse_timestamp(report["created_at"])
        if created_at > now or (since is not None and created_at < since):
            continue
        illness = (report.get("illness") or "").strip() or "Not specified"
        counts[illness] += 1

    return {
        "days": days if days is not None else "all",
        "generated_at": now.isoformat(),
        "total_reports": sum(counts.values()),
        "illnesses": [
            {"illness": illness, "reports": count}
            for illness, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ],
    }
