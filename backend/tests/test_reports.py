from unittest.mock import patch

import pytest
from flask import Flask
from postgrest.exceptions import APIError

from app.routes.reports import ILLNESSES, reports_bp


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(reports_bp, url_prefix="/api/reports")
    return app.test_client()


@pytest.fixture
def storage():
    with patch("app.routes.reports.get_supabase") as factory:
        yield factory.return_value


def test_saves_details_without_returning_private_fields(client, storage):
    storage.table.return_value.insert.return_value.execute.return_value.data = [{
        "id": 1, "location_id": None, "severity": 3,
        "created_at": "2026-09-19T12:00:00Z",
        "address": "123 Main St", "illness": "Flu",
    }]
    response = client.post("/api/reports", json={
        "address": " 123 Main St ", "illness": " Flu ", "severity": 3,
    })
    assert response.status_code == 201
    storage.table.return_value.insert.assert_called_once_with({
        "address": "123 Main St", "illness": "Flu", "severity": 3, "location_id": None,
    })
    assert "address" not in response.json[0]
    assert "illness" not in response.json[0]


@pytest.mark.parametrize("override", [
    {"address": " "}, {"address": "x" * 501}, {"address": 123},
    {"illness": ""}, {"illness": "x" * 201}, {"illness": None}, {"illness": "Cough"}, {"illness": "invented illness"},
    {"severity": 0}, {"severity": 6}, {"severity": True}, {"severity": "3"},
    {"location_id": -1}, {"location_id": True},
])
def test_rejects_invalid_fields(client, storage, override):
    payload = {"address": "123 Main St", "illness": "Flu", "severity": 3}
    payload.update(override)
    assert client.post("/api/reports", json=payload).status_code == 400
    storage.table.assert_not_called()


@pytest.mark.parametrize("payload", [[], "text", 5, {}])
def test_rejects_non_object_or_empty_body(client, storage, payload):
    assert client.post("/api/reports", json=payload).status_code == 400
    storage.table.assert_not_called()


def test_storage_failure_does_not_expose_details(client, storage):
    storage.table.return_value.insert.return_value.execute.side_effect = RuntimeError("secret")
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3,
    })
    assert response.status_code == 503
    assert "secret" not in response.get_data(as_text=True)


def test_unknown_location(client, storage):
    storage.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23503", "message": "Foreign key violation", "details": None, "hint": None,
    })
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "severity": 3, "location_id": 999,
    })
    assert response.status_code == 400


def test_public_report_query_excludes_private_details(client, storage):
    storage.table.return_value.select.return_value.order.return_value.execute.return_value.data = []
    assert client.get("/api/reports").status_code == 200
    storage.table.return_value.select.assert_called_once_with("id,location_id,severity,created_at")


@pytest.mark.parametrize("illness", ILLNESSES)
def test_accepts_each_supported_illness(client, storage, illness):
    storage.table.return_value.insert.return_value.execute.return_value.data = [{
        "id": 1, "location_id": None, "severity": 3,
        "created_at": "2026-09-19T12:00:00Z",
    }]
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": illness, "severity": 3,
    })
    assert response.status_code == 201
    assert storage.table.return_value.insert.call_args.args[0]["illness"] == illness


@pytest.mark.parametrize("flu_type", ["A", "B"])
def test_saves_flu_type(client, storage, flu_type):
    storage.table.return_value.insert.return_value.execute.return_value.data = [{
        "id": 1, "location_id": None, "severity": 3,
        "created_at": "2026-09-19T12:00:00Z",
    }]
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": "Flu", "flu_type": flu_type, "severity": 3,
    })
    assert response.status_code == 201
    assert storage.table.return_value.insert.call_args.args[0]["illness"] == f"Flu {flu_type}"


@pytest.mark.parametrize("illness,flu_type", [
    ("Flu", "C"), ("Flu", ""), ("Flu", 1), ("Flu", ["A"]),
    ("Flu", {"type": "A"}), ("Common cold", "A"), ("Stomach bug", "B"),
])
def test_rejects_invalid_flu_type(client, storage, illness, flu_type):
    response = client.post("/api/reports", json={
        "address": "123 Main St", "illness": illness, "flu_type": flu_type, "severity": 3,
    })
    assert response.status_code == 400
    storage.table.assert_not_called()
