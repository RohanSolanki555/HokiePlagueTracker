from unittest.mock import patch

import pytest
from flask import Flask
from postgrest.exceptions import APIError

from app.routes.reports import ILLNESSES, reports_bp
from app.services.google_maps_service import (
    GoogleMapsError,
    GoogleMapsNotConfigured,
    PlaceNotFound,
)
from app.services.map_service import blur_to_area

HOME = {"address": "123 Main St, Blacksburg, VA", "illness": "Flu", "severity": 3}
DORM = {"residence_type": "dorm", "dorm_id": 5, "floor": 3, "illness": "Flu", "severity": 3}
GEOCODED = {"latitude": 37.23012, "longitude": -80.41803, "formatted_address": "123 Main St, Blacksburg, VA 24060"}
PUBLIC_REPORT = {"id": 1, "location_id": None, "severity": 3, "created_at": "2026-09-19T12:00:00Z"}


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(reports_bp, url_prefix="/api/reports")
    return app.test_client()


@pytest.fixture
def storage():
    with patch("app.routes.reports.get_supabase") as factory:
        storage = factory.return_value
        storage.table.return_value.insert.return_value.execute.return_value.data = [{
            **PUBLIC_REPORT, "address": "private", "area_latitude": 1.5, "area_longitude": 2.5,
        }]
        dorm_lookup = storage.table.return_value.select.return_value.eq.return_value
        dorm_lookup.eq.return_value.limit.return_value.execute.return_value.data = [{"id": 5, "floors": 10}]
        yield storage


@pytest.fixture(autouse=True)
def lookup():
    with patch("app.routes.reports.lookup_place", return_value=dict(GEOCODED)) as lookup:
        yield lookup


def inserted(storage):
    return storage.table.return_value.insert.call_args.args[0]


def set_dorms(storage, rows):
    dorm_lookup = storage.table.return_value.select.return_value.eq.return_value
    dorm_lookup.eq.return_value.limit.return_value.execute.return_value.data = rows


def test_home_report_stores_only_a_blurred_cell(client, storage, lookup):
    response = client.post("/api/reports", json={**HOME, "address": " 123 Main St, Blacksburg, VA "})
    assert response.status_code == 201
    lookup.assert_called_once_with(address="123 Main St, Blacksburg, VA")
    cell = blur_to_area(GEOCODED["latitude"], GEOCODED["longitude"])
    assert inserted(storage) == {
        "residence_type": "home", "severity": 3, "illness": "Flu", "location_id": None,
        "area_latitude": cell[0], "area_longitude": cell[1],
    }
    assert response.json == {"report": PUBLIC_REPORT}
    body = response.get_data(as_text=True)
    assert "private" not in body and "37.23012" not in body and "Main St" not in body
    storage.table.return_value.select.assert_not_called()  # No location row is looked up or created.


def test_address_only_clients_are_treated_as_home_reports(client, storage):
    assert client.post("/api/reports", json=HOME).status_code == 201
    assert inserted(storage)["residence_type"] == "home"


def test_dorm_report_links_to_the_dorm_and_floor_without_geocoding(client, storage, lookup):
    response = client.post("/api/reports", json=DORM)
    assert response.status_code == 201
    lookup.assert_not_called()
    assert inserted(storage) == {
        "residence_type": "dorm", "severity": 3, "illness": "Flu", "location_id": 5, "floor": 3,
    }
    assert "address" not in inserted(storage)


def test_dorm_report_checks_the_dorm_is_a_dorm(client, storage):
    storage.table.return_value.select.assert_not_called()
    assert client.post("/api/reports", json=DORM).status_code == 201
    storage.table.assert_any_call("locations")
    chain = storage.table.return_value.select.return_value
    chain.eq.assert_called_once_with("id", 5)
    chain.eq.return_value.eq.assert_called_once_with("is_dorm", True)


@pytest.mark.parametrize("override", [
    {"dorm_id": None}, {"dorm_id": 0}, {"dorm_id": -1}, {"dorm_id": True}, {"dorm_id": "5"}, {"dorm_id": 5.0},
    {"floor": None}, {"floor": 0}, {"floor": 61}, {"floor": True}, {"floor": "3"}, {"floor": 2.0},
])
def test_dorm_report_rejects_invalid_dorm_or_floor_before_storage(client, storage, override):
    response = client.post("/api/reports", json={**DORM, **override})
    assert response.status_code == 400
    storage.table.assert_not_called()


def test_unknown_or_non_dorm_location_is_rejected(client, storage):
    set_dorms(storage, [])
    response = client.post("/api/reports", json=DORM)
    assert response.status_code == 400
    storage.table.return_value.insert.assert_not_called()


def test_floor_above_the_dorms_top_floor_is_rejected(client, storage):
    set_dorms(storage, [{"id": 5, "floors": 4}])
    assert client.post("/api/reports", json={**DORM, "floor": 4}).status_code == 201
    response = client.post("/api/reports", json={**DORM, "floor": 5})
    assert response.status_code == 400
    assert "1 to 4" in response.json["error"]


def test_dorm_lookup_failure_does_not_expose_details(client, storage):
    storage.table.return_value.select.side_effect = RuntimeError("secret")
    response = client.post("/api/reports", json=DORM)
    assert response.status_code == 503
    assert "secret" not in response.get_data(as_text=True)


@pytest.mark.parametrize("override", [
    {"address": " "}, {"address": "x" * 501}, {"address": 123}, {"address": None},
    {"illness": ""}, {"illness": "x" * 201}, {"illness": None},
    {"illness": "Cough"}, {"illness": "invented illness"},
    {"severity": 0}, {"severity": 6}, {"severity": True}, {"severity": "3"},
    {"residence_type": "castle"}, {"residence_type": None},
])
def test_rejects_invalid_home_fields_before_geocoding_or_storage(client, storage, lookup, override):
    payload = {**HOME, **override}
    assert client.post("/api/reports", json=payload).status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()


def test_home_report_requires_an_address(client, storage, lookup):
    payload = {key: value for key, value in HOME.items() if key != "address"}
    assert client.post("/api/reports", json=payload).status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()


@pytest.mark.parametrize("override", [
    {"illness": "Cough"}, {"severity": 9}, {"illness": None}, {"flu_type": "C"},
])
def test_rejects_invalid_illness_details_for_dorm_reports(client, storage, override):
    assert client.post("/api/reports", json={**DORM, **override}).status_code == 400
    storage.table.assert_not_called()


@pytest.mark.parametrize("payload", [[], "text", 5, {}])
def test_rejects_non_object_or_empty_body(client, storage, lookup, payload):
    assert client.post("/api/reports", json=payload).status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()


@pytest.mark.parametrize("error,status", [
    (PlaceNotFound("No location found for that address."), 404),
    (GoogleMapsNotConfigured("private configuration"), 503),
    (GoogleMapsError("private Google details and API key"), 502),
])
def test_address_lookup_failure_does_not_save_a_report(client, storage, lookup, error, status):
    lookup.side_effect = error
    response = client.post("/api/reports", json=HOME)
    assert response.status_code == status
    assert "address" in response.json["error"].lower()
    assert "private" not in response.get_data(as_text=True)
    storage.table.assert_not_called()


@pytest.mark.parametrize("error", [
    RuntimeError("secret"),
    APIError({"code": "08000", "message": "secret", "details": None, "hint": None}),
])
@pytest.mark.parametrize("payload", [HOME, DORM])
def test_storage_failure_does_not_expose_details(client, storage, error, payload):
    storage.table.return_value.insert.return_value.execute.side_effect = error
    response = client.post("/api/reports", json=payload)
    assert response.status_code == 503
    assert "secret" not in response.get_data(as_text=True)


def test_dorm_removed_before_report_insert_returns_an_error(client, storage):
    storage.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23503", "message": "Foreign key violation", "details": None, "hint": None,
    })
    assert client.post("/api/reports", json=DORM).status_code == 400


def test_empty_insert_response_is_not_reported_as_success(client, storage):
    storage.table.return_value.insert.return_value.execute.return_value.data = []
    assert client.post("/api/reports", json=HOME).status_code == 503


def test_public_report_query_excludes_private_details(client, storage):
    storage.table.return_value.select.return_value.order.return_value.execute.return_value.data = []
    assert client.get("/api/reports").status_code == 200
    storage.table.return_value.select.assert_called_once_with("id,location_id,severity,created_at")


@pytest.mark.parametrize("illness", ILLNESSES)
def test_accepts_each_supported_illness(client, storage, illness):
    assert client.post("/api/reports", json={**HOME, "illness": illness}).status_code == 201
    assert inserted(storage)["illness"] == illness


@pytest.mark.parametrize("flu_type", ["A", "B"])
def test_saves_flu_type(client, storage, flu_type):
    assert client.post("/api/reports", json={**HOME, "flu_type": flu_type}).status_code == 201
    assert inserted(storage)["illness"] == f"Flu {flu_type}"


@pytest.mark.parametrize("illness,flu_type", [
    ("Flu", "C"), ("Flu", ""), ("Flu", 1), ("Flu", ["A"]),
    ("Flu", {"type": "A"}), ("Common cold", "A"), ("Stomach bug", "B"),
])
def test_rejects_invalid_flu_type(client, storage, lookup, illness, flu_type):
    response = client.post("/api/reports", json={**HOME, "illness": illness, "flu_type": flu_type})
    assert response.status_code == 400
    lookup.assert_not_called()
    storage.table.assert_not_called()
