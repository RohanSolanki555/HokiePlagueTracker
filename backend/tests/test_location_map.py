from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import httpx
from postgrest import SyncPostgrestClient

from app import create_app
from app.services.map_service import blur_to_area, distance_km, get_map_data, read_all, summarize_reports


NOW = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)


def test_real_postgrest_builder_sends_one_offset_per_page():
    offsets = []
    def handle(request):
        assert len(request.url.params.get_list("offset")) == 1
        assert len(request.url.params.get_list("limit")) == 1
        offset = int(request.url.params["offset"])
        offsets.append(offset)
        # Simulate a server row cap below PAGE_SIZE.
        return httpx.Response(200, json=[{"id": index} for index in range(5)][offset:offset + 2])

    with httpx.Client(base_url="https://database.test", transport=httpx.MockTransport(handle)) as http:
        client = SyncPostgrestClient("https://database.test", http_client=http)
        rows = list(read_all(lambda: client.table("locations").select("id").order("id")))
    assert [row["id"] for row in rows] == list(range(5))
    assert offsets == [0, 2, 4, 5]


class FakeQuery:
    def __init__(self, rows, cap):
        self.rows = list(rows)
        self.cap = cap

    def select(self, _columns):
        return self

    def order(self, column):
        self.rows.sort(key=lambda row: row[column])
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
        self.rows = [row for row in self.rows if row[column] in values]
        return self

    def range(self, start, end):
        self.page = self.rows[start:min(end + 1, start + self.cap)]
        return self

    def execute(self):
        return SimpleNamespace(data=self.page)


class FakeSupabase:
    def __init__(self, locations, reports, cap=2):
        self.tables = {"locations": locations, "reports": reports}
        self.cap = cap
        self.read_tables = []

    def table(self, name):
        self.read_tables.append(name)
        return FakeQuery(self.tables[name], self.cap)


def location(id, latitude=37.2296, longitude=-80.4139, is_dorm=True):
    return {
        "id": id, "name": f"Location {id}", "location_type": "Residence", "is_dorm": is_dorm,
        "latitude": latitude, "longitude": longitude,
    }


def report(id, location_id, age, severity=3):
    return {"id": id, "location_id": location_id, "severity": severity, "created_at": (NOW - age).isoformat()}


def test_map_joins_by_id_and_paginates_without_losing_reports():
    database = FakeSupabase(
        [location(1), location(2), location(3, 38), location(4, None), location(5, float("nan"))],
        [
            report(1, 1, timedelta(hours=1), 2),
            report(2, 1, timedelta(hours=2), 4),
            report(3, 1, timedelta(days=1), 3),
            report(4, 1, timedelta(days=7), 1),  # Current period boundary.
            report(5, 1, timedelta(days=8)),
            report(6, 1, timedelta(days=14)),  # Previous period boundary.
            report(7, 1, timedelta(days=15)),
            report(8, 3, timedelta(hours=1)),  # Outside the radius.
            report(9, 1, timedelta(hours=-1)),  # Future reports are excluded.
            report(10, 4, timedelta(hours=1)),  # Unmapped locations are excluded.
        ],
    )
    data = get_map_data(database, 37.2296, -80.4139, 3, 7, NOW)
    assert [row["id"] for row in data["locations"]] == [1, 2]
    assert data["unmapped_locations"] == 2
    first, second = data["locations"]
    assert first["stats"]["total_reports"] == 4
    assert first["stats"]["reports_today"] == 2
    assert first["stats"]["average_severity"] == 2.5
    assert first["stats"]["previous_period_reports"] == 2
    assert first["stats"]["change_percent"] == 100
    assert second["stats"]["total_reports"] == 0  # Same coordinates, distinct ID.
    assert second["stats"]["average_severity"] is None
    assert data["summary"] == first["stats"]


def test_empty_area_does_not_query_reports():
    database = FakeSupabase([location(1, 40)], [])
    data = get_map_data(database, 0, 0, 3, 7, NOW)
    assert data["locations"] == []
    assert data["summary"]["total_reports"] == 0
    # Only the home-report read runs; no per-dorm report lookup is made.
    assert database.read_tables.count("reports") == 1


def test_zero_coordinates_are_valid_and_dateline_distance_is_short():
    database = FakeSupabase([location(1, 0, 0)], [])
    assert len(get_map_data(database, 0, 0, 0.1, 7, NOW)["locations"]) == 1
    assert 22 < distance_km(0, 179.9, 0, -179.9) < 23
    assert distance_km(90, 0, -90, 180) == pytest.approx(20015.1144, rel=1e-6)


def test_many_location_ids_are_batched_without_double_counting():
    database = FakeSupabase(
        [location(id) for id in range(1, 106)],
        [report(id, id, timedelta(hours=1)) for id in range(1, 106)],
        cap=30,
    )
    data = get_map_data(database, 37.2296, -80.4139, 3, 7, NOW)
    assert len(data["locations"]) == 105
    assert data["summary"]["total_reports"] == 105
    assert database.read_tables.count("reports") >= 2


def test_today_uses_eastern_midnight_and_new_reports_have_no_percentage():
    stats = summarize_reports([
        report(1, 1, timedelta(hours=8)),  # 04:00 UTC = midnight EDT.
        report(2, 1, timedelta(hours=8, seconds=1)),
    ], NOW, 7)
    assert stats["reports_today"] == 1
    assert stats["total_reports"] == 2
    assert stats["change_percent"] is None


@pytest.mark.parametrize("query", [
    "latitude=91&longitude=0", "latitude=0&longitude=-181",
    "latitude=NaN&longitude=0", "latitude=0&longitude=inf",
    "latitude=1", "longitude=1", "latitude=&longitude=0",
    "radius_km=0", "radius_km=101", "radius_km=NaN",
    "days=0", "days=31", "days=1.5", "days=hello",
])
def test_invalid_map_queries_fail_before_accessing_database(query, monkeypatch):
    def unexpected_database_access():
        pytest.fail("Invalid parameters reached the database")
    monkeypatch.setattr("app.routes.locations.get_supabase", unexpected_database_access)
    response = create_app().test_client().get(f"/api/locations/map?{query}")
    assert response.status_code == 400
    assert response.json["error"]


def test_map_endpoint_returns_real_data_and_preserves_id(monkeypatch):
    database = FakeSupabase([location(42)], [])
    monkeypatch.setattr("app.routes.locations.get_supabase", lambda: database)
    response = create_app().test_client().get("/api/locations/map")
    assert response.status_code == 200
    assert response.json["locations"][0]["id"] == 42
    assert response.json["center"] == {"latitude": 37.2296, "longitude": -80.4139}


@pytest.mark.parametrize("endpoint,module", [("/api/locations/map", "locations"), ("/api/stats/summary", "stats")])
def test_database_failures_are_not_reported_as_zero(endpoint, module, monkeypatch):
    def fail():
        raise RuntimeError("private database details")
    monkeypatch.setattr(f"app.routes.{module}.get_supabase", fail)
    response = create_app().test_client().get(endpoint)
    assert response.status_code == 503
    assert "private" not in response.json["error"]
    assert "reports_today" not in response.json


def test_summary_endpoint_uses_database_counts(monkeypatch):
    now = datetime.now(timezone.utc)
    database = FakeSupabase([], [
        {"id": 1, "location_id": 42, "severity": 2, "created_at": (now - timedelta(seconds=1)).isoformat()},
    ])
    monkeypatch.setattr("app.routes.stats.get_supabase", lambda: database)
    response = create_app().test_client().get("/api/stats/summary")
    assert response.status_code == 200
    assert response.json["reports_this_week"] == 1
    assert response.json["weekly_change"] is None


@pytest.fixture(autouse=True)
def authenticated_route_tests(monkeypatch):
    # These tests cover map/pin behavior; test_auth.py exercises the real auth guard.
    monkeypatch.setattr("app.require_verified_user", lambda: None)


def home(id, age, latitude=37.2301, longitude=-80.418, severity=2):
    return {
        "id": id, "location_id": None, "residence_type": "home", "severity": severity,
        "created_at": (NOW - age).isoformat(), "area_latitude": latitude, "area_longitude": longitude,
    }


def test_blur_snaps_nearby_points_to_one_cell_centre_and_is_stable():
    first, second = blur_to_area(37.23012, -80.41803), blur_to_area(37.23049, -80.41821)
    assert first == second
    assert blur_to_area(*first) == first
    assert abs(first[0] - 37.23012) <= 0.0025 + 1e-9 and abs(first[1] + 80.41803) <= 0.0025 + 1e-9
    assert blur_to_area(0, 0) == (0.0025, 0.0025)
    assert blur_to_area(-0.0001, -0.0001) == (-0.0025, -0.0025)


def test_only_dorms_are_sent_to_the_map():
    database = FakeSupabase([location(1), location(2, is_dorm=False)], [])
    data = get_map_data(database, 37.2296, -80.4139, 3, 7, NOW)
    assert [row["id"] for row in data["locations"]] == [1]


def test_home_reports_become_anonymous_cells_and_count_toward_the_summary():
    cell = blur_to_area(37.23012, -80.41803)
    database = FakeSupabase([location(1)], [
        report(1, 1, timedelta(hours=1)),
        home(2, timedelta(hours=1), *cell),
        home(3, timedelta(hours=2), *blur_to_area(37.23049, -80.41821)),  # Same cell.
        home(4, timedelta(days=8), *cell),  # Previous period: no pin, still in the comparison.
        home(5, timedelta(hours=1), 40, -80),  # Outside the radius.
        home(6, timedelta(hours=1), None, None),  # No usable position.
    ])
    data = get_map_data(database, 37.2296, -80.4139, 3, 7, NOW)
    assert data["home_areas"] == [{"latitude": cell[0], "longitude": cell[1], "reports": 2}]
    assert data["summary"]["total_reports"] == 3
    assert data["summary"]["previous_period_reports"] == 1
    assert data["locations"][0]["stats"]["total_reports"] == 1  # Dorm stats exclude home reports.


def test_stored_home_positions_are_blurred_again_before_leaving_the_api():
    exact = (37.23012, -80.41803)
    database = FakeSupabase([], [home(1, timedelta(hours=1), *exact)])
    area = get_map_data(database, 37.2296, -80.4139, 3, 7, NOW)["home_areas"][0]
    assert (area["latitude"], area["longitude"]) == blur_to_area(*exact) != exact
    assert set(area) == {"latitude", "longitude", "reports"}


def test_location_list_only_returns_dorms(monkeypatch):
    class Unpaged(FakeQuery):
        def execute(self):
            return SimpleNamespace(data=self.rows)

    rows = [location(1), location(2, is_dorm=False)]
    monkeypatch.setattr("app.routes.locations.get_supabase", lambda: SimpleNamespace(
        table=lambda name: Unpaged(rows, 100),
    ))
    listed = create_app().test_client().get("/api/locations").json
    assert [row["id"] for row in listed] == [1]


@pytest.mark.parametrize("days,count", [(7, 2), (14, 4), (30, 6), (None, 8)])
def test_period_filters_dorm_and_home_reports_including_all_time(days, count):
    database = FakeSupabase([location(1), location(2, 40)], [
        *[report(index, 1, timedelta(days=age)) for index, age in enumerate([1, 10, 20, 400], 1)],
        *[home(index, timedelta(days=age)) for index, age in enumerate([2, 12, 25, 800], 10)],
        report(20, 1, timedelta(hours=-1)),
        home(21, timedelta(hours=-1)),
        report(22, 2, timedelta(days=1)),
        home(23, timedelta(days=1), 40, -80),
    ])
    data = get_map_data(database, 37.2296, -80.4139, 3, days, NOW)
    assert data["days"] == ("all" if days is None else days)
    assert data["summary"]["total_reports"] == count
    assert data["locations"][0]["stats"]["total_reports"] == count // 2
    assert data["home_areas"][0]["reports"] == count // 2
    if days is None:
        assert data["summary"]["change_percent"] is None
        assert data["summary"]["previous_period_reports"] == 0


def test_all_time_empty_area_has_no_prior_period():
    data = get_map_data(FakeSupabase([], []), 37.2296, -80.4139, 3, None, NOW)
    assert data["summary"]["total_reports"] == 0
    assert data["summary"]["change_percent"] is None


def test_all_time_route_includes_old_reports_and_respects_radius(monkeypatch):
    database = FakeSupabase([location(1), location(2, 37.25)], [
        report(1, 1, timedelta(days=5000)), report(2, 2, timedelta(days=5000)),
    ])
    monkeypatch.setattr("app.routes.locations.get_supabase", lambda: database)
    client = create_app().test_client()
    for radius, total in [(0.5, 1), (3, 2)]:
        response = client.get(f"/api/locations/map?days=all&radius_km={radius}")
        assert response.status_code == 200
        assert response.json["summary"]["total_reports"] == total
