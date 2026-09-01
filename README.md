# Sinal — Agentic Platform

Plataforma agentic de atendimento para a operadora fictícia **Onda Telecom**.
Um agente conversacional consome capacidades corporativas expostas como **tools
via MCP**, nunca acessando a API de negócio diretamente.

> Todos os dados são fictícios. A operadora "Onda Telecom" não existe e nenhum
> dado real de assinante é utilizado.

## Arquitetura em uma linha

```
React (SSE) → BFF/Gateway (authn) → Agent (agent loop) → MCP Server (authz de tool) → API corporativa
```

Cada camada roda em processo próprio e as fronteiras são contratos, não imports.
A separação é deliberadamente poliglota para que o acoplamento seja impossível
por construção.

| Serviço | Stack | Papel |
|---|---|---|
| `apps/web` | React + TypeScript | Interface conversacional com streaming |
| `apps/bff` | Node.js + TypeScript | Gateway, autenticação, SSE, correlation-id |
| `apps/agent` | Python + Strands Agents | Agent loop, tool calling, memória de sessão |
| `apps/mcp-server` | Node.js + TypeScript | MCP Server (Streamable HTTP), tools, autorização |
| `apps/api-telecom` | Python + FastAPI | Sistema de registro corporativo (dados fictícios) |

## Documentação

| Documento | Conteúdo |
|---|---|
| `docs/ARCHITECTURE.md` | Decisões, fronteiras e diagramas |
| `docs/SECURITY.md` | Identidades, autorização de tools, guardrails |
| `docs/OBSERVABILITY.md` | Tracing ponta a ponta, métricas, logs |
| `docs/DEPLOY.md` | Estratégia AWS e ambiente de demonstração |
| `docs/RISKS.md` | Riscos conhecidos e mitigações |
| `docs/adr/` | Architecture Decision Records |

## Desenvolvimento

Pré-requisitos: Node 20+, Python 3.12, `uv`, Docker.

```bash
cp .env.example .env
docker compose -f infra/docker/compose.yaml up -d
```

Segredos nunca são versionados. `.env` está no `.gitignore` e o alvo de
produção usa AWS Secrets Manager com credencial obtida por IAM role.
