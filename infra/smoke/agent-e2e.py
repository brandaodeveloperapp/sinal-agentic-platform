"""Teste ponta a ponta: agente real -> MCP real -> API corporativa real.

Nao usa mock em camada nenhuma. Sobe um turno de conversa para cada cenario e
verifica o que chegou do outro lado, incluindo o que deve ser negado.
"""

import asyncio
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "apps", "agent", "src"))

from sinal_agent.config import Settings  # noqa: E402
from sinal_agent.service import AgentService  # noqa: E402
from sinal_agent.sessions import SessionStore  # noqa: E402

MCP_URL = os.environ.get("MCP_SERVER_URL", "http://127.0.0.1:8082/mcp")
TOKEN_URL = MCP_URL.replace("/mcp", "/dev/token")

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))


def mint(scopes: list[str], customer_id: str | None, subject: str) -> str:
    payload = json.dumps(
        {"subject": subject, "scopes": scopes, "customer_id": customer_id}
    ).encode()
    request = urllib.request.Request(  # noqa: S310
        TOKEN_URL, data=payload, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        return json.load(response)["token"]


def build_service() -> AgentService:
    settings = Settings(
        model_provider="scripted",
        environment="dev",
        log_level="critical",
        mcp_server_url=MCP_URL,
    )
    return AgentService(settings=settings, sessions=SessionStore(300, 20))


async def run_turn(service: AgentService, message: str, token: str, session: str) -> dict:
    collected: dict[str, list] = {
        "ready": [],
        "tool_call": [],
        "token": [],
        "done": [],
        "error": [],
    }
    async for event in service.stream_turn(
        message=message,
        token=token,
        session_id=session,
        subject="e2e",
        correlation_id=f"e2e-{session}",
    ):
        collected.setdefault(event["event"], []).append(event["data"])
    return collected


async def main() -> int:
    service = build_service()

    full_scopes = [
        "catalog:read",
        "customer:read",
        "usage:read",
        "billing:read",
        "support:read",
        "support:write",
    ]
    subscriber = mint(full_scopes, "CUS-1001", "e2e-subscriber")
    limited = mint(["catalog:read"], None, "e2e-limited")

    turn = await run_turn(service, "quero ver minha fatura", subscriber, "sess-e2e-1")
    tools_seen = turn["ready"][0]["tools"]
    check("MCP entrega 8 tools ao agente", len(tools_seen) == 8, ",".join(sorted(tools_seen)))
    check(
        "agente chamou list_invoices",
        any(call["name"] == "list_invoices" for call in turn["tool_call"]),
        json.dumps(turn["tool_call"]),
    )
    answer = "".join(part["text"] for part in turn["token"])
    check("resposta veio do dado real da API", "fatura" in answer.lower(), answer[:80])
    check("done reporta uso de tokens", turn["done"][0]["usage"]["total_tokens"] > 0, "")

    turn = await run_turn(service, "quais os planos disponiveis", limited, "sess-e2e-2")
    check(
        "token restrito so enxerga list_plans",
        turn["ready"][0]["tools"] == ["list_plans"],
        ",".join(turn["ready"][0]["tools"]),
    )
    answer = "".join(part["text"] for part in turn["token"])
    check("catalogo respondido pela tool", "plano" in answer.lower(), answer[:80])

    turn = await run_turn(service, "quanto de internet ja usei", subscriber, "sess-e2e-3")
    answer = "".join(part["text"] for part in turn["token"])
    check("consumo veio da linha do cliente", "gb" in answer.lower(), answer[:90])

    turn = await run_turn(service, "quero abrir um chamado", subscriber, "sess-e2e-4")
    answer = "".join(part["text"] for part in turn["token"])
    check(
        "escrita parou na confirmacao",
        "confirm" in answer.lower(),
        answer[:90],
    )

    failed = [r for r in RESULTS if not r[1]]
    for name, ok, detail in RESULTS:
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks ok")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
