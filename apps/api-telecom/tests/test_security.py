def test_missing_credential_is_rejected(client):
    response = client.get("/v1/plans")
    assert response.status_code == 401
    assert response.json()["code"] == "http_401"


def test_wrong_credential_is_rejected(client):
    response = client.get("/v1/plans", headers={"x-api-key": "nope"})
    assert response.status_code == 401


def test_valid_credential_is_accepted(client, auth):
    response = client.get("/v1/plans", headers=auth)
    assert response.status_code == 200


def test_health_needs_no_credential(client):
    assert client.get("/health").status_code == 200


def test_valid_key_still_accepted_with_constant_time_compare(client, auth):
    assert client.get("/v1/plans", headers=auth).status_code == 200


def test_prod_refuses_default_api_key(monkeypatch):

    from sinal_api import config as config_module

    config_module.get_settings.cache_clear()
    monkeypatch.setenv("ENVIRONMENT", "prd")
    monkeypatch.setenv("API_KEYS", "dev-mcp-server-key")
    try:
        with __import__("pytest").raises(RuntimeError, match="development default"):
            config_module.get_settings()
    finally:
        config_module.get_settings.cache_clear()
