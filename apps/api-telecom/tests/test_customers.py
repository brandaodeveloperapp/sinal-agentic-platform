def test_get_customer(client, auth):
    response = client.get("/v1/customers/CUS-1001", headers=auth)
    assert response.status_code == 200
    assert response.json()["full_name"] == "Marina Andrade"


def test_unknown_customer_is_404(client, auth):
    response = client.get("/v1/customers/CUS-9999", headers=auth)
    assert response.status_code == 404
    assert response.json()["code"] == "http_404"


def test_customer_document_is_masked(client, auth):
    document = client.get("/v1/customers/CUS-1001", headers=auth).json()["document"]
    assert "*" in document


def test_list_lines(client, auth):
    lines = client.get("/v1/customers/CUS-1001/lines", headers=auth).json()
    assert len(lines) == 2
    assert {line["status"] for line in lines} == {"active", "suspended"}


def test_line_usage(client, auth):
    usage = client.get("/v1/lines/5511970001001/usage", headers=auth).json()
    assert usage["data_allowance_gb"] == 50
    assert float(usage["data_used_gb"]) == 43.7


def test_unknown_line_is_404(client, auth):
    assert client.get("/v1/lines/0000/usage", headers=auth).status_code == 404
