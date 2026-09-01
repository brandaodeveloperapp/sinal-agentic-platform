import pytest

from sinal_agent.specialists import (
    BILLING,
    GENERAL,
    KNOWLEDGE,
    TECHNICAL,
    triage,
)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("I want to see my invoice", "billing"),
        ("how do I pay my bill", "knowledge"),
        ("which plans are available", "billing"),
        ("how much data have I used", "technical"),
        ("show my lines", "technical"),
        ("I want to open a ticket", "technical"),
        ("how does roaming work when I travel", "knowledge"),
        ("how do I cancel my service", "knowledge"),
        ("hello there", "general"),
    ],
)
def test_triage_routes_to_the_right_specialist(message, expected):
    assert triage(message).name == expected


def test_billing_specialist_cannot_open_a_ticket():
    available = ["list_invoices", "open_support_ticket", "get_line_usage", "list_plans"]
    allowed = BILLING.allowed(available)
    assert "open_support_ticket" not in allowed
    assert "list_invoices" in allowed


def test_technical_specialist_can_open_a_ticket_but_not_read_invoices():
    available = ["list_invoices", "open_support_ticket", "get_line_usage"]
    allowed = TECHNICAL.allowed(available)
    assert "open_support_ticket" in allowed
    assert "get_line_usage" in allowed
    assert "list_invoices" not in allowed


def test_knowledge_specialist_is_limited_to_search_and_plans():
    available = ["search_knowledge_base", "list_plans", "list_invoices", "open_support_ticket"]
    allowed = KNOWLEDGE.allowed(available)
    assert set(allowed) == {"search_knowledge_base", "list_plans"}


def test_general_specialist_keeps_every_available_tool():
    available = ["list_invoices", "open_support_ticket", "get_line_usage"]
    assert GENERAL.allowed(available) == available


def test_specialist_intersects_with_the_callers_entitlement():
    # a caller who only has list_plans, routed to billing, gets just list_plans
    assert BILLING.allowed(["list_plans"]) == ["list_plans"]
