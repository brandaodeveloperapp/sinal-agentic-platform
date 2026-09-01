def test_server_error_fault(client, auth):
    response = client.get("/v1/plans", headers={**auth, "x-simulate-fault": "server-error"})
    assert response.status_code == 502


def test_rate_limit_fault_sets_retry_after(client, auth):
    response = client.get("/v1/plans", headers={**auth, "x-simulate-fault": "rate-limit"})
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "2"


def test_unknown_fault_is_ignored(client, auth):
    response = client.get("/v1/plans", headers={**auth, "x-simulate-fault": "banana"})
    assert response.status_code == 200


def test_correlation_id_is_echoed(client, auth):
    response = client.get("/health", headers={**auth, "x-correlation-id": "abc-123"})
    assert response.headers["x-correlation-id"] == "abc-123"
