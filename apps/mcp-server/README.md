# sinal-mcp-server

MCP Server que expõe as capacidades corporativas da Onda Telecom como **tools
autorizadas**. É a única porta entre o agente e a API de negócio.

Transporte: **Streamable HTTP** em `POST /mcp`, modo stateless — cada requisição
carrega a identidade do chamador e recebe um servidor MCP construído para ela.

## Autorização em três camadas

1. **Descoberta filtrada por identidade.** `tools/list` só devolve as tools cujos
   escopos o token possui. O modelo nunca vê uma capacidade que o usuário não
   pode usar, então não há como ele "tentar" chamá-la.
2. **Verificação na invocação.** `authorizeToolCall` revalida os escopos a cada
   chamada. Defesa em profundidade: adivinhar o nome da tool não basta.
3. **Vínculo determinístico de cliente.** O `customer_id` vem do token, não do
   argumento gerado pelo modelo. Pedir outro cliente exige o escopo
   `customer:any`; sem ele a chamada é negada **antes** de tocar a API.

Regras críticas ficam em código, fora do prompt e fora da decisão probabilística
do modelo.

## Tools

| Tool | Escopos | Escrita |
|---|---|---|
| `list_plans` | `catalog:read` | não |
| `get_customer_profile` | `customer:read` | não |
| `list_customer_lines` | `customer:read` | não |
| `get_line_usage` | `usage:read` | não |
| `list_invoices` | `billing:read` | não |
| `get_invoice_details` | `billing:read` | não |
| `list_support_tickets` | `support:read` | não |
| `open_support_ticket` | `support:write` | sim, com confirmação |

Recurso MCP: `sinal://catalog/plans` (somente com `catalog:read`).

## Human-in-the-loop

`open_support_ticket` só escreve com `confirmed=true`. Sem confirmação a tool
devolve `confirmation_required` com um preview e **nenhum efeito colateral** —
o agente precisa perguntar ao usuário antes de repetir a chamada.

## Resiliência

Timeout por tentativa, retry com backoff exponencial e jitter apenas em
`429/502/503/504` (respeitando `Retry-After`), e circuit breaker por upstream.
Erro nunca vaza stack trace para o modelo: vira mensagem acionável.

## Executar

```bash
npm install
npm run dev
```

Em `ENVIRONMENT=dev` existe `POST /dev/token` para emitir tokens de teste. O
endpoint **não é registrado** fora de dev.

```bash
curl -s localhost:8082/dev/token -H 'content-type: application/json' \
  -d '{"subject":"user-1","customer_id":"CUS-1001","scopes":["catalog:read","billing:read"]}'
```

## Testes

```bash
npm test
```

49 testes: política de autorização, JWT, resiliência (retry/timeout/breaker) e
**testes de protocolo MCP** com cliente real — descoberta filtrada, negação de
escalação de cliente, ownership de recurso e o fluxo de confirmação.
