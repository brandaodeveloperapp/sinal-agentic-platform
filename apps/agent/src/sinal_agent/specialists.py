"""Agent-to-agent routing: a triage step delegates to a focused specialist.

Instead of one agent holding every tool, a lightweight triage classifies the request
and hands it to a specialist configured with a narrower prompt and a smaller tool set.
This is the A2A pattern the role asks for, and it is also least privilege at the agent
layer: a billing specialist is never given the ticket-writing tool, so even a
prompt-injected billing turn cannot open a ticket.

The triage classifier is deterministic here so the behaviour is reproducible; the same
seam is where an LLM classifier plugs in. The specialist a request lands on is reported
to the caller in a ``route`` event, so which agent handled a turn is visible.
"""

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Specialist:
    name: str
    instructions: str
    tools: frozenset[str] = field(default_factory=frozenset)

    def allowed(self, available: list[str]) -> list[str]:
        """The specialist's tools intersected with what the caller may actually use."""
        if not self.tools:
            return available
        return [name for name in available if name in self.tools]


BILLING = Specialist(
    name="billing",
    instructions=(
        "You are the billing specialist. You handle invoices, payments and plans. "
        "Do not attempt network or support-ticket actions."
    ),
    tools=frozenset({"list_invoices", "get_invoice_details", "list_plans", "get_customer_profile"}),
)

TECHNICAL = Specialist(
    name="technical",
    instructions=(
        "You are the technical support specialist. You handle data usage, lines, network "
        "and support tickets. Confirm with the customer before opening a ticket."
    ),
    tools=frozenset(
        {
            "get_line_usage",
            "list_customer_lines",
            "list_support_tickets",
            "open_support_ticket",
            "search_knowledge_base",
        }
    ),
)

KNOWLEDGE = Specialist(
    name="knowledge",
    instructions=(
        "You are the help specialist. You answer how-to and policy questions from the "
        "help articles. Ground every answer in a retrieved passage."
    ),
    tools=frozenset({"search_knowledge_base", "list_plans"}),
)

GENERAL = Specialist(
    name="general",
    instructions="You are the general assistant. Use whatever tool best answers the question.",
    tools=frozenset(),
)

_RULES: list[tuple[str, Specialist]] = [
    (
        r"\bhow\s+(do|can|does|to)\b|\b(roaming|travel|abroad|cancel|esim|coverage|rollover)\b",
        KNOWLEDGE,
    ),
    (r"\b(invoice|bill|billing|charge|pay|payment|plan|plans|upgrade|downgrade)\b", BILLING),
    (
        r"\b(usage|data|internet|gb|line|lines|number|ticket|complaint|signal|network|stolen|swap)\b",
        TECHNICAL,
    ),
]

SPECIALISTS: dict[str, Specialist] = {s.name: s for s in (BILLING, TECHNICAL, KNOWLEDGE, GENERAL)}


def triage(message: str) -> Specialist:
    """Pick the specialist for a message; fall back to the general assistant."""
    lowered = message.lower()
    for pattern, specialist in _RULES:
        if re.search(pattern, lowered):
            return specialist
    return GENERAL
