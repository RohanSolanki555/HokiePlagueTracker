from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app import create_app
from app.services.dorm_service import get_dorm_detail, list_dorms

NOW = datetime(2026, 9, 19, 16, tzinfo=timezone.utc)  # Noon in Blacksburg.


class FakeQuery:
    def __init__(self, rows):
        self.rows = list(rows)
        self.start, self.stop = 0, None

    def select(self, _columns):
        return self

    def eq(self, column, value):
        self.rows = [row for row in self.rows if row.get(column) == value]
        return self

    def gte(self, column, value):
        self.rows = [row for row in self.rows if row[column] >= value]
        return self

    def lte(self, column, value):
        self.rows = [row for row in self.rows if row[column] <= value]
        return self

    def in_(self, column, values):
        self.rows = [row for row in self.rows if row.get(column) in values]
        return self

    def order(self, column):
        self.rows.sort(key=lambda row: row[column])
        return self

    def limit(self, count):
        self.stop = count
        return self

    def range(self, start, end):
        self.start, self.stop = start, end + 1
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows[self.start:self.stop])


class FakeSupabase:
    def __init__(self, locations, reports):
        self.tables = {"locations": locations, "reports": reports}

    def table(self, name):
        return FakeQuery(self.tables[name])


def dorm(id, name, floors=3, is_dorm=True):
    return {"id": id, "name": name, "floors": floors, "is_dorm": is_dorm, "latitude": 37.23, "longitude": -80.42}


def report(id, location_id, age, illness="Flu", floor=1, severity=3):
    return {
        "id": id, "location_id": location_id, "severity": severity, "illness": illness,
        "floor": floor, "created_at": (NOW - age).isoformat(),
    }


def test_list_shows_only_dorms_sorted_by_name_with_their_own_counts():
    database = FakeSupabase(
        [dorm(2, "Slusher Hall"), dorm(1, "Ambler Johnston"), dorm(3, "Newman Library", is_dorm=False)],
        [report(1, 1, timedelta(hours=1)), report(2, 1, timedelta(days=1)), report(3, 2, timedelta(hours=1)),
         report(4, 3, timedelta(hours=1))],
    )
    listed = list_dorms(database, 7, NOW)["dorms"]
    assert [(row["name"], row["stats"]["total_reports"]) for row in listed] == [("Ambler Johnston", 2), ("Slusher Hall", 1)]


def test_detail_breaks_reports_down_by_illness_day_and_floor():
    database = FakeSupabase([dorm(1, "Ambler Johnston", floors=4)], [
        report(1, 1, timedelta(hours=1), "Flu A", 2, 4),
        report(2, 1, timedelta(hours=2), "Flu A", 2, 2),
        report(3, 1, timedelta(days=2), "Norovirus", 4),
        report(4, 1, timedelta(days=3), "Common cold", 1),
        report(5, 1, timedelta(days=9), "Flu A", 3),  # Previous period: no breakdown, still compared.
        report(6, 2, timedelta(hours=1), "RSV", 1),  # Another location.
    ])
    detail = get_dorm_detail(database, 1, 7, NOW)
    assert detail["stats"]["total_reports"] == 4
    assert detail["stats"]["previous_period_reports"] == 1
    assert detail["illnesses"] == [
        {"illness": "Flu A", "reports": 2}, {"illness": "Common cold", "reports": 1}, {"illness": "Norovirus", "reports": 1},
    ]
    assert [entry["reports"] for entry in detail["floors"]] == [1, 2, 0, 1]
    assert detail["daily"][-1] == {"date": "2026-09-19", "reports": 2, "average_severity": 3.0}
    assert sum(day["reports"] for day in detail["daily"]) == 4
    assert len({day["date"] for day in detail["daily"]}) == len(detail["daily"])


def test_daily_series_is_one_entry_per_campus_day_including_empty_days():
    database = FakeSupabase([dorm(1, "Ambler Johnston")], [report(1, 1, timedelta(hours=1))])
    daily = get_dorm_detail(database, 1, 3, NOW)["daily"]
    assert [day["date"] for day in daily] == ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]
    assert [day["reports"] for day in daily] == [0, 0, 0, 1]
    assert daily[0]["average_severity"] is None


def test_missing_illness_and_unknown_floor_count_are_handled():
    row = report(1, 1, timedelta(hours=1), illness=None, floor=None)
    detail = get_dorm_detail(FakeSupabase([dorm(1, "Old Dorm", floors=None)], [row, report(2, 1, timedelta(hours=1), floor=5)]), 1, 7, NOW)
    assert {"illness": "Not specified", "reports": 1} in detail["illnesses"]
    assert detail["floors"] == [{"floor": 5, "reports": 1}]


def test_non_dorm_and_unknown_ids_return_none():
    database = FakeSupabase([dorm(3, "Newman Library", is_dorm=False)], [])
    assert get_dorm_detail(database, 3, 7, NOW) is None
    assert get_dorm_detail(database, 99, 7, NOW) is None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("app.require_verified_user", lambda: None)
    return create_app().test_client()


@pytest.mark.parametrize("query", ["days=0", "days=31", "days=1.5", "days=abc", "days="])
@pytest.mark.parametrize("path", ["/api/dorms", "/api/dorms/1"])
def test_invalid_days_fail_before_the_database(client, monkeypatch, path, query):
    def unexpected():
        pytest.fail("Invalid parameters reached the database")
    monkeypatch.setattr("app.routes.dorms.get_supabase", unexpected)
    assert client.get(f"{path}?{query}").status_code == 400


def test_dorm_endpoints_return_data_404_and_hide_failures(client, monkeypatch):
    database = FakeSupabase([dorm(1, "Ambler Johnston")], [])
    monkeypatch.setattr("app.routes.dorms.get_supabase", lambda: database)
    assert client.get("/api/dorms").json["dorms"][0]["name"] == "Ambler Johnston"
    assert client.get("/api/dorms/1?days=14").json["days"] == 14
    assert client.get("/api/dorms/99").status_code == 404

    def fail():
        raise RuntimeError("private database details")
    monkeypatch.setattr("app.routes.dorms.get_supabase", fail)
    for path in ("/api/dorms", "/api/dorms/1"):
        response = client.get(path)
        assert response.status_code == 503
        assert "private" not in response.get_data(as_text=True)


def test_dorm_endpoints_require_login():
    assert create_app().test_client().get("/api/dorms").status_code == 401
