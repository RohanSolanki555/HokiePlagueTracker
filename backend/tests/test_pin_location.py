from types import SimpleNamespace

import httpx
import pytest

from app import create_app
from app.config import Config
from app.services import google_maps_service

LIBRARY = {
    "place_id": "ChIJ-library",
    "formatted_address": "560 Drillfield Dr, Blacksburg, VA 24061, USA",
    "types": ["library", "point_of_interest", "establishment"],
    "geometry": {"location": {"lat": 37.2284, "lng": -80.4198}},
    "address_components": [{"long_name": "Blacksburg", "short_name": "Blacksburg", "types": ["locality"]}],
}
STREET = {
    "place_id": "ChIJ-street",
    "formatted_address": "225 Stanger St, Blacksburg, VA 24060, USA",
    "types": ["street_address"],
    "geometry": {"location": {"lat": 37.2301, "lng": -80.4180}},
    "address_components": [],
}


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "test-key")


def google_returns(monkeypatch, payload, place_name="Newman Library"):
    """Fake Geocoding (payload) and Places (place_name; None = API unavailable)."""
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.startswith(google_maps_service.PLACES_URL):
            if place_name is None:
                return SimpleNamespace(status_code=403, json=lambda: {"error": {}})
            return SimpleNamespace(status_code=200, json=lambda: {"displayName": {"text": place_name}})
        calls.append(params)
        return SimpleNamespace(status_code=200, json=lambda: payload)

    monkeypatch.setattr(google_maps_service.httpx, "get", fake_get)
    return calls


class FakeLocations:
    def __init__(self, rows):
        self.rows = rows
        self.inserted = []
        self.filters = {}
        self.pending = None

    def table(self, name):
        assert name == "locations"
        return self

    def select(self, _columns):
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def limit(self, _count):
        return self

    def insert(self, row):
        self.pending = {"id": 100 + len(self.inserted), **row}
        self.inserted.append(self.pending)
        return self

    def execute(self):
        if self.pending:
            data, self.pending = [self.pending], None
        else:
            data = [row for row in self.rows if all(row.get(k) == v for k, v in self.filters.items())]
        self.filters = {}
        return SimpleNamespace(data=data)


def post(path, body):
    return create_app().test_client().post(f"/api/locations/{path}", json=body)


def test_lookup_extracts_metadata_and_prefers_categorised_result(monkeypatch):
    calls = google_returns(monkeypatch, {"status": "OK", "results": [STREET, LIBRARY]})
    response = post("lookup", {"latitude": 37.2284, "longitude": -80.4198})
    assert response.status_code == 200
    assert response.json["name"] == "Newman Library"
    assert response.json["location_type"] == "Academic"
    assert response.json["place_id"] == "ChIJ-library"
    assert response.json["place_types"] == LIBRARY["types"]
    assert response.json["latitude"] == 37.2284
    assert calls[0]["latlng"] == "37.2284,-80.4198"
    assert calls[0]["key"] == "test-key"


def test_place_id_lookup_takes_coordinates_from_google(monkeypatch):
    calls = google_returns(monkeypatch, {"status": "OK", "results": [LIBRARY]})
    response = post("lookup", {"place_id": "ChIJ-library"})
    assert response.status_code == 200
    assert (response.json["latitude"], response.json["longitude"]) == (37.2284, -80.4198)
    assert calls[0]["place_id"] == "ChIJ-library" and "latlng" not in calls[0]


def test_name_falls_back_to_the_address_when_places_is_unavailable(monkeypatch):
    google_returns(monkeypatch, {"status": "OK", "results": [LIBRARY]}, place_name=None)
    response = post("lookup", {"latitude": 37.2284, "longitude": -80.4198})
    assert response.status_code == 200
    assert response.json["name"] == "560 Drillfield Dr"


def test_name_and_type_overrides_win_and_uncategorised_pins_are_other(monkeypatch):
    google_returns(monkeypatch, {"status": "OK", "results": [STREET]}, place_name=None)
    metadata = post("lookup", {"latitude": 37.23, "longitude": -80.418}).json
    assert (metadata["name"], metadata["location_type"]) == ("225 Stanger St", "Other")
    metadata = post("lookup", {"latitude": 37.23, "longitude": -80.418, "name": " Squires ", "location_type": "Dining"}).json
    assert (metadata["name"], metadata["location_type"]) == ("Squires", "Dining")


def test_pin_saves_metadata_to_supabase(monkeypatch):
    google_returns(monkeypatch, {"status": "OK", "results": [LIBRARY]})
    database = FakeLocations([])
    monkeypatch.setattr("app.routes.locations.get_supabase", lambda: database)
    response = post("pin", {"latitude": 37.2284, "longitude": -80.4198})
    assert response.status_code == 201
    assert response.json["created"] is True
    saved = database.inserted[0]
    assert saved["name"] == "Newman Library"
    assert saved["place_id"] == "ChIJ-library"
    assert saved["formatted_address"].startswith("560 Drillfield Dr")
    assert (saved["latitude"], saved["longitude"]) == (37.2284, -80.4198)
    assert response.json["location"]["id"] == saved["id"]


def test_pinning_the_same_place_twice_returns_the_existing_row(monkeypatch):
    google_returns(monkeypatch, {"status": "OK", "results": [LIBRARY]})
    database = FakeLocations([{"id": 7, "place_id": "ChIJ-library", "name": "Newman Library"}])
    monkeypatch.setattr("app.routes.locations.get_supabase", lambda: database)
    response = post("pin", {"latitude": 37.2284, "longitude": -80.4198})
    assert response.status_code == 200
    assert response.json == {"location": {"id": 7, "place_id": "ChIJ-library", "name": "Newman Library"}, "created": False}
    assert database.inserted == []


@pytest.mark.parametrize("body", [
    None, [], {}, {"latitude": 1}, {"longitude": 1}, {"latitude": 91, "longitude": 0},
    {"latitude": 0, "longitude": -181}, {"latitude": "1", "longitude": 2}, {"latitude": True, "longitude": 2},
    {"latitude": float("nan"), "longitude": 0}, {"place_id": 5}, {"place_id": "x" * 301},
    {"latitude": 0, "longitude": 0, "name": "x" * 121}, {"latitude": 0, "longitude": 0, "location_type": "Moon"},
])
def test_invalid_pins_fail_before_calling_google(body, monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid request reached Google")
    monkeypatch.setattr(google_maps_service.httpx, "get", unexpected)
    response = post("pin", body)
    assert response.status_code == 400
    assert response.json["error"]


def test_pin_with_no_address_returns_404(monkeypatch):
    google_returns(monkeypatch, {"status": "ZERO_RESULTS", "results": []})
    assert post("lookup", {"latitude": 0, "longitude": 0}).status_code == 404


def test_missing_google_key_is_reported_without_calling_google(monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", None)
    response = post("lookup", {"latitude": 1, "longitude": 1})
    assert response.status_code == 503
    assert "not configured" in response.json["error"]


@pytest.mark.parametrize("payload", [
    {"status": "REQUEST_DENIED", "error_message": "The provided API key is invalid.", "results": []},
    {"status": "OVER_QUERY_LIMIT", "results": []},
])
def test_google_rejections_do_not_leak_details(payload, monkeypatch):
    google_returns(monkeypatch, payload)
    response = post("lookup", {"latitude": 1, "longitude": 1})
    assert response.status_code == 502
    assert "invalid" not in response.json["error"] and "test-key" not in response.get_data(as_text=True)


def test_network_failure_returns_502_and_never_chains_the_key(monkeypatch):
    def unreachable(url, params, timeout):
        raise httpx.ConnectError(f"cannot reach {url}?key={params['key']}")
    monkeypatch.setattr(google_maps_service.httpx, "get", unreachable)
    with pytest.raises(google_maps_service.GoogleMapsError) as raised:
        google_maps_service.lookup_place(1, 1)
    assert raised.value.__cause__ is None and raised.value.__suppress_context__
    assert post("lookup", {"latitude": 1, "longitude": 1}).status_code == 502


def test_database_failure_when_saving_returns_503(monkeypatch):
    google_returns(monkeypatch, {"status": "OK", "results": [LIBRARY]})
    def fail():
        raise RuntimeError("private database details")
    monkeypatch.setattr("app.routes.locations.get_supabase", fail)
    response = post("pin", {"latitude": 1, "longitude": 1})
    assert response.status_code == 503
    assert "private" not in response.json["error"]


@pytest.fixture(autouse=True)
def authenticated_route_tests(monkeypatch):
    # These tests cover map/pin behavior; test_auth.py exercises the real auth guard.
    monkeypatch.setattr("app.require_verified_user", lambda: None)
