# sinal-api-telecom

API REST corporativa da operadora fictícia Onda Telecom. É o sistema de registro
por trás das tools MCP — o agente nunca a chama diretamente.

## Executar

```bash
uv venv --python 3.12
uv pip install -e ".[dev]" --group dev
.venv/bin/uvicorn sinal_api.main:app --port 8081 --reload
```

Documentação interativa em `http://localhost:8081/docs`.

## Autenticação

A API aceita apenas uma **credencial de workload** (`x-api-key`), nunca o token
do usuário final. A identidade do usuário viaja em `x-acting-user` apenas para
auditoria: a decisão de autorização acontece na camada MCP, antes da chamada.

## Injeção de falhas

Fora de produção, o header `x-simulate-fault` força comportamentos usados nos
testes de resiliência do cliente MCP:

| Valor | Efeito |
|---|---|
| `timeout` | Trava a resposta por 30s |
| `server-error` | Retorna 502 |
| `rate-limit` | Retorna 429 com `Retry-After` |

## Contrato

`python scripts/export_openapi.py` regenera
`packages/contracts/openapi/onda-telecom.openapi.json`, consumido pelos testes
de contrato do MCP Server.

## Testes

```bash
.venv/bin/python -m pytest
```
