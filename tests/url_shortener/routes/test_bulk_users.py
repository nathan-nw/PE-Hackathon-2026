"""Tests for the /users/bulk endpoint."""

import csv
import io


def test_bulk_load_no_file(client):
    res = client.post("/users/bulk", json={})
    assert res.status_code == 400


def test_bulk_load_file_not_found(client):
    res = client.post("/users/bulk", json={"file": "nonexistent.csv"})
    assert res.status_code == 404


def test_bulk_load_via_upload(client):
    csv_data = io.BytesIO()
    writer = csv.writer(io.TextIOWrapper(csv_data, write_through=True))
    writer.writerow(["username", "email"])
    writer.writerow(["bulkuser1", "bulk1@example.com"])
    writer.writerow(["bulkuser2", "bulk2@example.com"])
    csv_data.seek(0)

    res = client.post(
        "/users/bulk",
        data={"file": (csv_data, "users.csv")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    data = res.get_json()
    assert data["imported"] == 2


def test_bulk_load_skips_blank_rows(client):
    csv_data = io.BytesIO()
    writer = csv.writer(io.TextIOWrapper(csv_data, write_through=True))
    writer.writerow(["username", "email"])
    writer.writerow(["", ""])
    writer.writerow(["valid", "valid@example.com"])
    csv_data.seek(0)

    res = client.post(
        "/users/bulk",
        data={"file": (csv_data, "users.csv")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    assert res.get_json()["imported"] == 1


def test_bulk_load_skips_duplicate_username(client):
    # testuser already exists (from conftest)
    csv_data = io.BytesIO()
    writer = csv.writer(io.TextIOWrapper(csv_data, write_through=True))
    writer.writerow(["username", "email"])
    writer.writerow(["testuser", "different@example.com"])
    csv_data.seek(0)

    res = client.post(
        "/users/bulk",
        data={"file": (csv_data, "users.csv")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    assert res.get_json()["skipped"] >= 1


def test_bulk_load_with_explicit_id(client):
    csv_data = io.BytesIO()
    writer = csv.writer(io.TextIOWrapper(csv_data, write_through=True))
    writer.writerow(["id", "username", "email"])
    writer.writerow(["999", "id999", "id999@example.com"])
    csv_data.seek(0)

    res = client.post(
        "/users/bulk",
        data={"file": (csv_data, "users.csv")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    assert res.get_json()["imported"] == 1


def test_bulk_load_upsert_existing_id(client):
    # Create user with known id
    csv_data = io.BytesIO()
    writer = csv.writer(io.TextIOWrapper(csv_data, write_through=True))
    writer.writerow(["id", "username", "email"])
    writer.writerow(["1", "updated_name", "updated@example.com"])
    csv_data.seek(0)

    res = client.post(
        "/users/bulk",
        data={"file": (csv_data, "users.csv")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    assert res.get_json()["imported"] == 1

    # Verify update
    res2 = client.get("/users/1")
    assert res2.get_json()["username"] == "updated_name"
