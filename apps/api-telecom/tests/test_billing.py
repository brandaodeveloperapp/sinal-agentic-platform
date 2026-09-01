def test_list_invoices_sorted_desc(client, auth):
    invoices = client.get("/v1/customers/CUS-1001/invoices", headers=auth).json()
    months = [inv["reference_month"] for inv in invoices]
    assert months == sorted(months, reverse=True)


def test_filter_invoices_by_status(client, auth):
    invoices = client.get(
        "/v1/customers/CUS-1001/invoices", params={"status": "overdue"}, headers=auth
    ).json()
    assert len(invoices) == 1
    assert invoices[0]["id"] == "INV-2026-07-1001"


def test_invalid_status_filter_is_422(client, auth):
    response = client.get(
        "/v1/customers/CUS-1001/invoices", params={"status": "exploded"}, headers=auth
    )
    assert response.status_code == 422


def test_get_invoice(client, auth):
    invoice = client.get("/v1/invoices/INV-2026-08-1001", headers=auth).json()
    assert invoice["status"] == "open"
