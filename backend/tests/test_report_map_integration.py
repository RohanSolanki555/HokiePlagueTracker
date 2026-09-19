"""Exercise report writes followed by real map aggregation, without external calls."""

from datetime import datetime, timezone
import json

import httpx
import pytest
from postgrest import SyncPostgrestClient

from app import create_app
from app.services.google_maps_service import GoogleMapsError, PlaceNotFound
from app.services.map_service import save_pinned_location


METADATA = {
    "name": "225 Stanger St", "location_type": "Other",
    "latitude": 37.2301, "longitude": -80.418,
    "place_id": "test-stanger-st",
    "formatted_address": "225 Stanger St, Blacksburg, VA 24060",
    "place_types": ["street_address"], "address_components": [],
}
PAYLOAD = {"address": METADATA["formatted_address"], "illness": "Flu", "severity": 3}


class MemoryDatabase:
    """A small HTTP stub so writes and map reads use actual PostgREST queries."""

    def __init__(self):
        self.tables = {"locations": [], "reports": []}
        self.reject_report = False
        self.concurrent_pin = False
        self.concurrent_coordinates = None
        self.reject_location_update = False
        self.unconfirmed_location_update = False

    def handle(self, request):
        table = request.url.path.rsplit("/", 1)[-1]
        rows = self.tables[table]
        if request.method == "POST":
            data = json.loads(request.content)
            if table == "reports" and self.reject_report:
                return httpx.Response(503, json={
                    "code": "08000", "message": "private insert error",
                    "details": None, "hint": None,
                })
            row = {"id": len(rows) + 1, **data}
            if table == "reports":
                row["created_at"] = datetime.now(timezone.utc).isoformat()
            rows.append(row)
            if table == "locations" and self.concurrent_pin:
                # Another request inserted the same unique Google place after
                # our SELECT but before our INSERT.
                self.concurrent_pin = False
                if self.concurrent_coordinates is not None:
                    row.update(self.concurrent_coordinates)
                return httpx.Response(409, json={
                    "code": "23505", "message": "duplicate place",
                    "details": None, "hint": None,
                })
            return httpx.Response(201, json=[row])

        assert request.method in ("GET", "PATCH")
        params = request.url.params
        data = list(rows)
        for column, expression in params.multi_items():
            if column in ("select", "order", "limit", "offset"):
                continue
            operator, value = expression.split(".", 1)
            if operator == "eq":
                data = [row for row in data if str(row.get(column)) == value]
            elif operator == "gte":
                data = [row for row in data if row[column] >= value]
            elif operator == "lte":
                data = [row for row in data if row[column] <= value]
            elif operator == "in":
                values = value.strip("()").split(",")
                data = [row for row in data if str(row[column]) in values]
            else:
                pytest.fail(f"Unhandled filter: {expression}")
        if request.method == "PATCH":
            assert table == "locations"
            if self.reject_location_update:
                return httpx.Response(503, json={
                    "code": "08000", "message": "private update error",
                    "details": None, "hint": None,
                })
            if self.unconfirmed_location_update:
                return httpx.Response(200, json=[])
            updates = json.loads(request.content)
            assert set(updates).issubset({"latitude", "longitude"})
            for row in data:
                row.update(updates)
            return httpx.Response(200, json=data)
        if "order" in params:
            column, direction = params["order"].split(".", 1)
            data.sort(key=lambda row: row[column], reverse=direction == "desc")
        offset = int(params.get("offset", 0))
        data = data[offset:offset + int(params.get("limit", len(data)))]
        columns = params.get("select", "*")
        if columns != "*":
            data = [{key: row[key] for key in columns.split(",")} for row in data]
        return httpx.Response(200, json=data)


@pytest.fixture
def system(monkeypatch):
    database = MemoryDatabase()
    with httpx.Client(
        base_url="https://database.test",
        transport=httpx.MockTransport(database.handle),
    ) as http:
        storage = SyncPostgrestClient("https://database.test", http_client=http)
        monkeypatch.setattr("app.routes.reports.get_supabase", lambda: storage)
        monkeypatch.setattr("app.routes.locations.get_supabase", lambda: storage)
        monkeypatch.setattr("app.routes.stats.get_supabase", lambda: storage)
        monkeypatch.setattr("app.routes.reports.lookup_place", lambda **_: dict(METADATA))
        yield create_app().test_client(), database, storage


@pytest.mark.parametrize("already_pinned", [False, True])
def test_reports_at_same_address_increment_one_pin_and_summary(system, already_pinned):
    client, database, storage = system
    if already_pinned:
        save_pinned_location(storage, METADATA)
    for expected_count in (1, 2):
        response = client.post("/api/reports", json=PAYLOAD)
        assert response.status_code == 201
        assert response.json["report"]["location_id"] == response.json["location"]["id"] == 1
        assert len(database.tables["locations"]) == 1
        mapped = client.get("/api/locations/map")
        assert mapped.status_code == 200
        assert len(mapped.json["locations"]) == 1
        assert mapped.json["locations"][0]["stats"]["total_reports"] == expected_count
        assert mapped.json["summary"]["total_reports"] == expected_count
        assert client.get("/api/stats/summary").json["reports_this_week"] == expected_count

    public_reports = client.get("/api/reports").json
    assert len(public_reports) == 2
    assert all(set(row) == {"id", "location_id", "severity", "created_at"} for row in public_reports)


@pytest.mark.parametrize("failure,status", [
    ("validation", 400), ("missing_address", 404),
    ("google", 502), ("insert", 503),
])
def test_failed_submission_does_not_increase_existing_counts(system, monkeypatch, failure, status):
    client, database, _storage = system
    assert client.post("/api/reports", json=PAYLOAD).status_code == 201
    payload = dict(PAYLOAD)
    if failure == "validation":
        payload["illness"] = "Invalid"
    elif failure in ("missing_address", "google"):
        def fail(**_):
            if failure == "missing_address":
                raise PlaceNotFound("No location found for that address.")
            raise GoogleMapsError("private lookup details")
        monkeypatch.setattr("app.routes.reports.lookup_place", fail)
    else:
        database.reject_report = True
    response = client.post("/api/reports", json=payload)
    assert response.status_code == status
    mapped = client.get("/api/locations/map").json
    assert len(database.tables["reports"]) == 1
    assert len(database.tables["locations"]) == 1
    assert mapped["locations"][0]["stats"]["total_reports"] == 1
    assert mapped["summary"]["total_reports"] == 1


def test_failed_first_report_can_leave_an_empty_pin_but_never_a_report_count(system):
    client, database, _storage = system
    database.reject_report = True
    assert client.post("/api/reports", json=PAYLOAD).status_code == 503
    mapped = client.get("/api/locations/map").json
    assert len(database.tables["reports"]) == 0
    assert mapped["summary"]["total_reports"] == 0
    assert mapped["locations"][0]["stats"]["total_reports"] == 0


@pytest.mark.parametrize("unpositioned", [False, True])
def test_simultaneous_first_reports_reuse_the_unique_google_place(system, unpositioned):
    client, database, _storage = system
    database.concurrent_pin = True
    if unpositioned:
        database.concurrent_coordinates = {"latitude": None, "longitude": None}
    response = client.post("/api/reports", json=PAYLOAD)
    assert response.status_code == 201
    assert len(database.tables["locations"]) == 1
    assert response.json["report"]["location_id"] == database.tables["locations"][0]["id"]
    assert client.get("/api/locations/map").json["summary"]["total_reports"] == 1

@pytest.mark.parametrize("latitude,longitude", [
    (None, None), (None, -80.419), (91, -80.419),
    (37.23, None), (37.23, -181), ("NaN", None),
])
def test_report_repairs_invalid_coordinate_pair_and_preserves_saved_name(system, latitude, longitude):
    client, database, _storage = system
    existing = {
        **METADATA, "id": 42, "name": "My saved building",
        "latitude": latitude, "longitude": longitude,
    }
    database.tables["locations"].append(existing)
    expected_latitude = METADATA["latitude"]
    expected_longitude = METADATA["longitude"]

    response = client.post("/api/reports", json=PAYLOAD)
    assert response.status_code == 201
    assert response.json["report"]["location_id"] == 42
    assert response.json["location"]["latitude"] == expected_latitude
    assert response.json["location"]["longitude"] == expected_longitude
    assert response.json["location"]["name"] == "My saved building"
    assert len(database.tables["locations"]) == 1
    assert existing["latitude"] == expected_latitude
    assert existing["longitude"] == expected_longitude
    mapped = client.get("/api/locations/map").json
    assert mapped["unmapped_locations"] == 0
    assert mapped["locations"][0]["id"] == 42
    assert mapped["locations"][0]["stats"]["total_reports"] == 1


def test_report_preserves_a_valid_saved_position_and_name(system):
    client, database, _storage = system
    saved = {
        **METADATA, "id": 42, "name": "Custom building name",
        "latitude": 37.23, "longitude": -80.419,
    }
    database.tables["locations"].append(dict(saved))
    database.reject_location_update = True
    response = client.post("/api/reports", json=PAYLOAD)
    assert response.status_code == 201
    assert database.tables["locations"] == [saved]
    assert response.json["location"]["latitude"] == saved["latitude"]
    assert response.json["location"]["longitude"] == saved["longitude"]
    assert response.json["location"]["name"] == saved["name"]


@pytest.mark.parametrize("failure", ["reject", "unconfirmed"])
def test_unpositioned_pin_update_failure_does_not_save_a_report(system, failure):
    client, database, _storage = system
    database.tables["locations"].append({
        **METADATA, "id": 42, "latitude": None, "longitude": None,
    })
    database.reject_location_update = failure == "reject"
    database.unconfirmed_location_update = failure == "unconfirmed"
    assert client.post("/api/reports", json=PAYLOAD).status_code == 503
    assert database.tables["reports"] == []
    assert client.get("/api/locations/map").json["summary"]["total_reports"] == 0
