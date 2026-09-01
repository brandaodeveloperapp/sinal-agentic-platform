def test_list_tickets(client, auth):
    tickets = client.get("/v1/customers/CUS-1001/tickets", headers=auth).json()
    assert tickets[0]["id"] == "TCK-4410"


def test_create_ticket_records_caller(client, auth):
    response = client.post(
        "/v1/tickets",
        json={
            "customer_id": "CUS-1002",
            "category": "billing",
            "summary": "Customer reports a duplicate charge on the August invoice",
        },
        headers=auth,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "open"
    assert body["opened_by"] == "tester"


def test_short_summary_is_rejected(client, auth):
    response = client.post(
        "/v1/tickets",
        json={"customer_id": "CUS-1002", "category": "billing", "summary": "short"},
        headers=auth,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_ticket_for_unknown_customer_is_404(client, auth):
    response = client.post(
        "/v1/tickets",
        json={
            "customer_id": "CUS-0000",
            "category": "network",
            "summary": "Unknown customer opening a network ticket",
        },
        headers=auth,
    )
    assert response.status_code == 404


def test_ticket_summary_is_stored_verbatim_by_the_system_of_record(client, auth):
    tickets = client.get("/v1/customers/CUS-1001/tickets", headers=auth).json()
    downtown = next(t for t in tickets if t["id"] == "TCK-4410")
    assert "Ignore all previous instructions" in downtown["summary"]
