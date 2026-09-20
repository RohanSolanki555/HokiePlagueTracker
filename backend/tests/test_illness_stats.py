from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from postgrest import SyncPostgrestClient

from app import create_app
from app.services.stats_service import get_illness_summary


NOW = datetime(2026, 9, 19, 16, tzinfo=timezone.utc)


def report(id, age, illness="Flu A", **fields):
    return {"id": id, "illness": illness, "severity": 3, "created_at": (NOW - age).isoformat(), **fields}


@contextmanager
def database(rows, fail_offset=None):
    """Exercise real query builders against a server capped at two rows per page."""
    offsets = []

    def respond(request):
        assert request.url.path.endswith("/reports")
        params = request.url.params
        assert set(params) <= {"select", "created_at", "order", "offset", "limit"}
        assert params["select"] == "illness,created_at,severity"
        assert params["order"] == "id.asc"
        assert len(params.get_list("offset")) == 1
        offset = int(params["offset"])
        offsets.append(offset)
        if fail_offset is not None and offset >= fail_offset:
            raise httpx.ConnectError("private database details")
        matches = sorted(rows, key=lambda row: row["id"])
        for condition in params.get_list("created_at"):
            comparison, timestamp = condition.split(".", 1)
            boundary = datetime.fromisoformat(timestamp)
            if comparison == "gte":
                matches = [row for row in matches if datetime.fromisoformat(row["created_at"]) >= boundary]
            elif comparison == "lte":
                matches = [row for row in matches if datetime.fromisoformat(row["created_at"]) <= boundary]
            else:
                pytest.fail(f"Unexpected date comparison: {comparison}")
        return httpx.Response(200, json=[
            {column: row.get(column) for column in ("illness", "created_at", "severity")}
            for row in matches[offset:offset + 2]
        ])

    with httpx.Client(base_url="https://database.test", transport=httpx.MockTransport(respond)) as http:
        yield SyncPostgrestClient("https://database.test", http_client=http), offsets


def test_summary_paginates_all_residences_and_legacy_reports_without_private_fields():
    rows = [
        report(1, timedelta(hours=1), residence_type="dorm", location_id=10, floor=2),
        report(2, timedelta(hours=1), residence_type="home", area_latitude=37.2, area_longitude=-80.4),
        report(3, timedelta(hours=1), "Flu B", residence_type=None, address="legacy address"),
        report(4, timedelta(hours=1), "Common cold", user_id="private-user-id"),
        # Missing map coordinates must not remove an otherwise valid report.
        report(5, timedelta(hours=1), "Common cold", residence_type="home", area_latitude=None),
    ]
    with database(rows) as (client, offsets):
        summary = get_illness_summary(client, 7, NOW)
    assert offsets == [0, 2, 4, 5]
    assert summary == {
        "days": 7,
        "generated_at": NOW.isoformat(),
        "total_reports": 5,
        "stats": {
            "total_reports": 5,
            "reports_today": 5,
            "previous_period_reports": 0,
            "change_percent": None,
            "average_severity": 3.0,
            "latest_report_at": (NOW - timedelta(hours=1)).isoformat(),
        },
        "illnesses": [
            {"illness": "Common cold", "reports": 2},
            {"illness": "Flu A", "reports": 2},
            {"illness": "Flu B", "reports": 1},
        ],
    }


@pytest.mark.parametrize("days,count", [(1, 1), (7, 2), (14, 3), (30, 4), (None, 5)])
def test_selected_period_counts_both_inclusive_boundaries_and_excludes_future(days, count):
    ages = [0, 7, 14, 30, 400]
    rows = [report(index, timedelta(days=age)) for index, age in enumerate(ages)]
    rows.append(report(99, timedelta(microseconds=-1), "RSV"))
    with database(rows) as (client, _):
        summary = get_illness_summary(client, days, NOW)
    assert summary["days"] == ("all" if days is None else days)
    assert summary["total_reports"] == count
    assert summary["illnesses"] == [{"illness": "Flu A", "reports": count}]
    assert summary["stats"]["total_reports"] == count
    assert summary["stats"]["reports_today"] == 1
    if days is None:
        assert summary["stats"]["previous_period_reports"] == 0
        assert summary["stats"]["change_percent"] is None


def test_stats_and_illnesses_share_current_reports_with_previous_period_comparison():
    rows = [
        report(1, timedelta(0), "Flu A", severity=5),
        # Exactly midnight in Blacksburg and just before midnight.
        report(2, timedelta(hours=12), "Flu B", severity=1),
        report(3, timedelta(hours=12, microseconds=1), "Flu A", severity=3),
        report(4, timedelta(days=7), "COVID-19", severity=3),
        report(5, timedelta(days=7, microseconds=1), "RSV", severity=5),
        report(6, timedelta(days=14), "RSV", severity=5),
        report(7, timedelta(days=14, microseconds=1), "RSV", severity=5),
        report(8, timedelta(microseconds=-1), "RSV", severity=5),
    ]
    with database(rows) as (client, offsets):
        summary = get_illness_summary(client, 7, NOW)
    # Only the current and previous windows are queried, including every page.
    assert offsets == [0, 2, 4, 6]
    assert summary["stats"] == {
        "total_reports": 4,
        "reports_today": 2,
        "previous_period_reports": 2,
        "change_percent": 100.0,
        "average_severity": 3.0,
        "latest_report_at": NOW.isoformat(),
    }
    assert summary["illnesses"] == [
        {"illness": "Flu A", "reports": 2},
        {"illness": "COVID-19", "reports": 1},
        {"illness": "Flu B", "reports": 1},
    ]
    assert summary["total_reports"] == summary["stats"]["total_reports"] == sum(
        illness["reports"] for illness in summary["illnesses"]
    )


def test_period_excludes_report_just_before_start():
    with database([
        report(1, timedelta(days=7)),
        report(2, timedelta(days=7, microseconds=1)),
    ]) as (client, _):
        assert get_illness_summary(client, 7, NOW)["total_reports"] == 1


def test_blank_illnesses_are_grouped_and_names_are_trimmed():
    rows = [report(index, timedelta(hours=1), illness) for index, illness in enumerate([
        None, "", "   ", " Flu B ", "Flu B",
    ])]
    with database(rows) as (client, _):
        summary = get_illness_summary(client, 7, NOW)
    assert summary["illnesses"] == [
        {"illness": "Not specified", "reports": 3},
        {"illness": "Flu B", "reports": 2},
    ]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("app.require_verified_user", lambda: None)
    return create_app().test_client()


@pytest.mark.parametrize("query,expected", [("", 7), ("?days=1", 1), ("?days=30", 30), ("?days=all", "all")])
def test_endpoint_returns_an_empty_summary_for_valid_periods(client, monkeypatch, query, expected):
    with database([]) as (db, _):
        monkeypatch.setattr("app.routes.stats.get_supabase", lambda: db)
        response = client.get(f"/api/stats/illnesses{query}")
    assert response.status_code == 200
    assert response.json["days"] == expected
    assert response.json["total_reports"] == 0
    assert response.json["illnesses"] == []
    assert response.json["stats"] == {
        "total_reports": 0,
        "reports_today": 0,
        "previous_period_reports": 0,
        "change_percent": None if expected == "all" else 0,
        "average_severity": None,
        "latest_report_at": None,
    }
    assert datetime.fromisoformat(response.json["generated_at"]).tzinfo is not None


@pytest.mark.parametrize("days", ["0", "31", "1.5", "abc", "", "-1", "ALL"])
def test_invalid_days_fail_before_database_access(client, monkeypatch, days):
    def unexpected():
        pytest.fail("Invalid parameters reached the database")
    monkeypatch.setattr("app.routes.stats.get_supabase", unexpected)
    response = client.get(f"/api/stats/illnesses?days={days}")
    assert response.status_code == 400
    assert response.json["error"]


@pytest.mark.parametrize("fail_offset", [0, 2])
def test_failed_first_or_later_page_returns_error_without_partial_counts(client, monkeypatch, fail_offset):
    with database([report(index, timedelta(hours=1)) for index in range(3)], fail_offset) as (db, _):
        monkeypatch.setattr("app.routes.stats.get_supabase", lambda: db)
        response = client.get("/api/stats/illnesses?days=all")
    assert response.status_code == 503
    assert "private" not in response.get_data(as_text=True)
    assert "total_reports" not in response.json


def test_endpoint_requires_login():
    assert create_app().test_client().get("/api/stats/illnesses").status_code == 401
