"""Report writes followed by real map/dorm reads over PostgREST queries, without external calls."""

from datetime import datetime, timezone
import json

import httpx
import pytest
from postgrest import SyncPostgrestClient

from app import create_app
from app.services.google_maps_service import GoogleMapsError, PlaceNotFound
from app.services.map_service import blur_to_area


HOUSE = {
    "latitude": 37.23012, "longitude": -80.41803,
    "formatted_address": "225 Stanger St, Blacksburg, VA 24060",
}
NEIGHBOR = {"latitude": 37.23049, "longitude": -80.41821, "formatted_address": "231 Stanger St, Blacksburg, VA 24060"}
DORM = {
    "id": 7, "name": "Pritchard Hall", "location_type": "Residence", "is_dorm": True, "floors": 6,
    "latitude": 37.2296, "longitude": -80.4210,
}
HOME_REPORT = {"address": HOUSE["formatted_address"], "illness": "Flu", "severity": 3}
DORM_REPORT = {"residence_type": "dorm", "dorm_id": 7, "floor": 3, "illness": "Norovirus", "severity": 4}


class MemoryDatabase:
    """A small HTTP stub so writes and reads use actual PostgREST queries."""

    def __init__(self):
        self.tables = {"locations": [dict(DORM)], "reports": []}
        self.reject_report = False

    def handle(self, request):
        table = request.url.path.rsplit("/", 1)[-1]
        rows = self.tables[table]
        if request.method == "POST":
            data = json.loads(request.content)
            if table == "reports" and self.reject_report:
                return httpx.Response(503, json={
                    "code": "08000", "message": "private insert error", "details": None, "hint": None,
                })
            row = {"id": len(rows) + 1, **data}
            if table == "reports":
                row["created_at"] = datetime.now(timezone.utc).isoformat()
            rows.append(row)
            return httpx.Response(201, json=[row])

        assert request.method == "GET"
        params = request.url.params
        data = list(rows)
        for column, expression in params.multi_items():
            if column in ("select", "order", "limit", "offset"):
                continue
            operator, value = expression.split(".", 1)
            if operator == "eq":
                data = [row for row in data if str(row.get(column)).lower() == value.lower()]
            elif operator == "gte":
                data = [row for row in data if row[column] >= value]
            elif operator == "lte":
                data = [row for row in data if row[column] <= value]
            elif operator == "in":
                values = value.strip("()").split(",")
                data = [row for row in data if str(row.get(column)) in values]
            else:
                pytest.fail(f"Unhandled filter: {expression}")
        if "order" in params:
            column, direction = params["order"].split(".", 1)
            data.sort(key=lambda row: row[column], reverse=direction == "desc")
        offset = int(params.get("offset", 0))
        data = data[offset:offset + int(params.get("limit", len(data)))]
        columns = params.get("select", "*")
        if columns != "*":
            data = [{key: row.get(key) for key in columns.split(",")} for row in data]
        return httpx.Response(200, json=data)


@pytest.fixture
def system(monkeypatch):
    monkeypatch.setattr("app.require_verified_user", lambda: None)
    database = MemoryDatabase()
    with httpx.Client(
        base_url="https://database.test",
        transport=httpx.MockTransport(database.handle),
    ) as http:
        storage = SyncPostgrestClient("https://database.test", http_client=http)
        for module in ("reports", "locations", "stats", "dorms"):
            monkeypatch.setattr(f"app.routes.{module}.get_supabase", lambda: storage)
        monkeypatch.setattr("app.routes.reports.lookup_place", lambda **_: dict(HOUSE))
        yield create_app().test_client(), database


def test_dorm_reports_feed_the_map_and_dorm_details(system):
    client, database = system
    for count in (1, 2):
        response = client.post("/api/reports", json=DORM_REPORT)
        assert response.status_code == 201
        assert response.json["report"]["location_id"] == 7
        mapped = client.get("/api/locations/map").json
        assert [row["id"] for row in mapped["locations"]] == [7]
        assert mapped["locations"][0]["stats"]["total_reports"] == count
        assert mapped["summary"]["total_reports"] == count
    assert len(database.tables["locations"]) == 1

    detail = client.get("/api/dorms/7").json
    assert detail["dorm"]["name"] == "Pritchard Hall"
    assert detail["illnesses"] == [{"illness": "Norovirus", "reports": 2}]
    assert [entry["reports"] for entry in detail["floors"]] == [0, 0, 2, 0, 0, 0]
    assert sum(day["reports"] for day in detail["daily"]) == detail["stats"]["total_reports"] == 2
    listed = client.get("/api/dorms").json["dorms"]
    assert [(dorm["name"], dorm["stats"]["total_reports"]) for dorm in listed] == [("Pritchard Hall", 2)]


def test_home_reports_create_an_anonymous_unclickable_cell_and_no_location(system):
    client, database = system
    assert client.post("/api/reports", json=HOME_REPORT).status_code == 201

    assert len(database.tables["locations"]) == 1  # Still just the dorm.
    stored = database.tables["reports"][0]
    cell = blur_to_area(HOUSE["latitude"], HOUSE["longitude"])
    assert stored["location_id"] is None and "address" not in stored
    assert (stored["area_latitude"], stored["area_longitude"]) == cell

    mapped = client.get("/api/locations/map")
    assert mapped.json["home_areas"] == [{"latitude": cell[0], "longitude": cell[1], "reports": 1}]
    assert [row["id"] for row in mapped.json["locations"]] == [7]
    assert mapped.json["summary"]["total_reports"] == 1
    everything = mapped.get_data(as_text=True) + client.get("/api/reports").get_data(as_text=True)
    assert "37.23012" not in everything and "Stanger" not in everything
    assert client.get("/api/stats/summary").json["reports_this_week"] == 1
    assert all(set(row) == {"id", "location_id", "severity", "created_at"} for row in client.get("/api/reports").json)


def test_reports_from_neighbouring_houses_share_one_cell(system, monkeypatch):
    client, _database = system
    assert client.post("/api/reports", json=HOME_REPORT).status_code == 201
    monkeypatch.setattr("app.routes.reports.lookup_place", lambda **_: dict(NEIGHBOR))
    assert client.post("/api/reports", json={**HOME_REPORT, "address": "231 Stanger St, Blacksburg, VA"}).status_code == 201
    areas = client.get("/api/locations/map").json["home_areas"]
    assert len(areas) == 1 and areas[0]["reports"] == 2


@pytest.mark.parametrize("failure,status", [
    ("validation", 400), ("missing_address", 404), ("google", 502), ("insert", 503),
])
def test_failed_submission_does_not_increase_counts(system, monkeypatch, failure, status):
    client, database = system
    assert client.post("/api/reports", json=HOME_REPORT).status_code == 201
    payload = dict(HOME_REPORT)
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
    assert client.post("/api/reports", json=payload).status_code == status
    mapped = client.get("/api/locations/map").json
    assert len(database.tables["reports"]) == 1
    assert mapped["summary"]["total_reports"] == 1
    assert mapped["home_areas"][0]["reports"] == 1


def test_unknown_dorm_and_non_dorm_locations_cannot_receive_reports(system):
    client, database = system
    database.tables["locations"].append({"id": 8, "name": "Newman Library", "is_dorm": False, "floors": None})
    for dorm_id in (8, 999):
        assert client.post("/api/reports", json={**DORM_REPORT, "dorm_id": dorm_id}).status_code == 400
    assert database.tables["reports"] == []
    assert client.get("/api/dorms/8").status_code == 404
