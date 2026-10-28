import pytest

PASSWORD = "Migration-local-123!"


def signin(client, csrf, email="admin@migration.invalid", **extra):
    return client.post("/api/v1/auth/signin", headers=csrf,
                       json={"email": email, "password": PASSWORD, **extra})


def test_register_remains_closed(client, database):
    before = database.users.count_documents({})
    for method in [client.get, client.post]:
        assert method("/register", follow_redirects=False).status_code == 403
    assert database.users.count_documents({}) == before


def test_auth_requires_verified_admin_and_csrf(client, csrf, database):
    assert client.get("/api/v1/auth/session").json() == {"authenticated": False, "is_admin": False}
    body = {"email": "admin@migration.invalid", "password": PASSWORD}
    assert client.post("/api/v1/auth/signin", json=body).status_code == 403
    assert client.post("/api/v1/auth/signin", json=body, headers={**csrf, "Origin": "https://evil.invalid"}).status_code == 403
    assert signin(client, csrf).json() == {"authenticated": True, "is_admin": True}
    assert client.get("/protected").status_code == 200
    new_csrf = {**csrf, "X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["csrf_token"]}
    assert client.post("/api/v1/auth/signout", headers=new_csrf).status_code == 200
    database.users.update_one({"email": "admin@migration.invalid"}, {"$set": {"email_verified": False}})
    assert signin(client, {**csrf, "X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["csrf_token"]}).status_code == 401


def test_nonadmin_session_and_shared_admin_checker(client, csrf):
    assert signin(client, csrf, "visitor@migration.invalid").json() == {"authenticated": True, "is_admin": False}
    from metamuseum.auth import admin_from_session
    assert admin_from_session({"user_id": "visitor@migration.invalid"}) is None
    assert admin_from_session({"user_id": "admin@migration.invalid"}).is_admin()


def test_cookie_flags_logout_csrf_and_safe_next(client):
    response = client.get("/api/v1/auth/csrf")
    cookie = response.headers["set-cookie"]
    csrf = {"X-CSRF-Token": response.json()["csrf_token"], "Origin": "http://testserver"}
    assert "httponly" in cookie.lower() and "samesite=lax" in cookie.lower()
    for target in ["https://evil.invalid/", "//evil.invalid/", "/\\evil.invalid", "/%5cevil.invalid", "/%0aLocation:evil"]:
        assert signin(client, csrf, next=target).status_code == 400
    assert signin(client, csrf, next="/kwanri").status_code == 200
    assert client.post("/api/v1/auth/signout").status_code == 403
    assert client.get("/logout").status_code == 405
    assert client.get("/api/v1/auth/session").json()["authenticated"]


def test_no_password_or_secret_in_response_or_log(client, csrf, settings, caplog):
    from metamuseum.models import User
    response = signin(client, csrf)
    body = response.text + client.get("/api/v1/auth/session").text + caplog.text
    for secret in [PASSWORD, settings.secret_key, settings.security_password_salt, User.objects.first().password]:
        assert secret not in body
    csrf["X-CSRF-Token"] = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    invalid = client.post("/api/v1/auth/signin", headers=csrf, json={"email": [], "password": PASSWORD})
    assert invalid.status_code == 422
    assert PASSWORD not in invalid.text


def test_confirmation_alias_updates_only_existing_account(client, settings, database):
    from metamuseum.auth import generate_confirmation_token
    email = "visitor@migration.invalid"
    database.users.update_one({"email": email}, {"$set": {"email_verified": False}})
    token = generate_confirmation_token(email, settings=settings)
    assert client.get("/confirm/" + token, follow_redirects=False).status_code == 303
    assert database.users.find_one({"email": email})["email_verified"]
    token = generate_confirmation_token("absent@migration.invalid", settings=settings)
    assert client.get("/confirm/" + token, follow_redirects=False).status_code == 400


def test_admin_dependency_checks_live_roles_and_mutation_csrf(app, settings, database):
    from fastapi import Depends
    from fastapi.testclient import TestClient
    from metamuseum.auth import require_admin, decode_session_cookie

    @app.api_route("/test-admin", methods=["GET", "POST"])
    def admin_probe(user=Depends(require_admin)):
        return {"allowed": True}

    with TestClient(app) as client:
        assert client.get("/test-admin").status_code == 403
        csrf = {"X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["csrf_token"], "Origin": "http://testserver"}
        assert signin(client, csrf).status_code == 200
        cookie = client.cookies.get(settings.session_cookie)
        assert decode_session_cookie(cookie, settings=settings)["user_id"] == "admin@migration.invalid"
        assert decode_session_cookie(cookie + "tampered", settings=settings) == {}
        assert client.get("/test-admin").json() == {"allowed": True}
        assert client.post("/test-admin").status_code == 403
        csrf["X-CSRF-Token"] = client.get("/api/v1/auth/csrf").json()["csrf_token"]
        assert client.post("/test-admin", headers=csrf).status_code == 200
        database.users.update_one({"email": "admin@migration.invalid"}, {"$set": {"user_type": []}})
        assert client.get("/test-admin").status_code == 403


def test_existing_bcrypt_accounts_keep_legacy_72_byte_password_behavior(client, csrf, database):
    import bcrypt
    password = "long-password-" * 7
    legacy_hash = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=4)).decode()
    database.users.update_one({"email": "admin@migration.invalid"}, {"$set": {"password": legacy_hash}})
    assert client.post("/api/v1/auth/signin", headers=csrf,
                       json={"email": "admin@migration.invalid", "password": password}).status_code == 200


def test_auth_responses_are_not_cached(client):
    assert client.get("/api/v1/auth/csrf").headers.get("cache-control") == "no-store"
    assert client.get("/api/v1/auth/session").headers.get("cache-control") == "no-store"
