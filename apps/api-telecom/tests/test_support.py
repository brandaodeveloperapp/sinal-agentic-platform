def test_list_tickets(client, auth):
    tickets = client.get("/v1/customers/CUS-1001/tickets", headers=auth).json()
    assert tickets[0]["id"] == "TCK-4410"


def test_create_ticket_records_caller(client, auth):
    response = client.post(
        "/v1/tickets",
        json={
            "customer_id": "CUS-1002",
            "category": "billing",
            "summary": "Cliente relata cobranca duplicada na fatura de agosto",
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
        json={"customer_id": "CUS-1002", "category": "billing", "summary": "curto"},
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
            "summary": "Cliente inexistente abrindo chamado de rede",
        },
        headers=auth,
    )
    assert response.status_code == 404
