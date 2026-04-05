"""Tests for user CRUD routes."""



def test_list_users(client):
    res = client.get("/users")
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) >= 1  # seeded user


def test_list_users_pagination(client):
    res = client.get("/users?page=1&per_page=1")
    assert res.status_code == 200
    assert len(res.get_json()) == 1


def test_get_user(client):
    res = client.get("/users/1")
    assert res.status_code == 200
    data = res.get_json()
    assert data["username"] == "testuser"


def test_get_user_not_found(client):
    res = client.get("/users/99999")
    assert res.status_code == 404
    assert "error" in res.get_json()


def test_create_user(client):
    res = client.post("/users", json={"username": "newuser", "email": "new@example.com"})
    assert res.status_code == 201
    data = res.get_json()
    assert data["username"] == "newuser"
    assert data["email"] == "new@example.com"


def test_create_user_missing_fields(client):
    res = client.post("/users", json={"username": "onlyname"})
    assert res.status_code == 400


def test_create_user_invalid_email(client):
    res = client.post("/users", json={"username": "u", "email": "not-an-email"})
    assert res.status_code == 400


def test_create_user_blank_fields(client):
    res = client.post("/users", json={"username": "  ", "email": "a@b.com"})
    assert res.status_code == 400


def test_create_user_non_string_fields(client):
    res = client.post("/users", json={"username": 123, "email": "a@b.com"})
    assert res.status_code == 400


def test_create_user_duplicate(client):
    client.post("/users", json={"username": "dup", "email": "dup@example.com"})
    res = client.post("/users", json={"username": "dup", "email": "dup2@example.com"})
    assert res.status_code == 409


def test_update_user(client):
    res = client.put("/users/1", json={"username": "updated"})
    assert res.status_code == 200
    assert res.get_json()["username"] == "updated"


def test_update_user_not_found(client):
    res = client.put("/users/99999", json={"username": "x"})
    assert res.status_code == 404


def test_update_user_invalid_username(client):
    res = client.put("/users/1", json={"username": ""})
    assert res.status_code == 400


def test_update_user_invalid_email(client):
    res = client.put("/users/1", json={"email": "nope"})
    assert res.status_code == 400


def test_update_user_blank_email(client):
    res = client.put("/users/1", json={"email": ""})
    assert res.status_code == 400


def test_delete_user(client):
    # Create a user to delete
    res = client.post("/users", json={"username": "todelete", "email": "del@example.com"})
    user_id = res.get_json()["id"]
    res = client.delete(f"/users/{user_id}")
    assert res.status_code == 200
    # Verify deleted
    res = client.get(f"/users/{user_id}")
    assert res.status_code == 404


def test_delete_user_not_found(client):
    res = client.delete("/users/99999")
    assert res.status_code == 404
