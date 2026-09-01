# sinal-agent

Agente conversacional em Python com **Strands Agents**. Executa o agent loop,
descobre ferramentas no MCP Server e transmite a resposta por SSE.

## Identidade: o agente não tem credencial própria

O agente repassa o **token do usuário final** para o MCP Server. Ele não possui
uma credencial privilegiada de acesso a dados, então não existe caminho em que o
agente enxergue mais do que o usuário logado enxerga.

```
usuário (JWT) → BFF → agent (repassa o JWT) → MCP (autoriza) → API (credencial de workload)
```

Três identidades distintas: a do usuário (JWT), a do agente (workload que fala
com o MCP) e a da ferramenta (chave de workload que fala com a API corporativa).

## Provider de modelo é configuração

| `MODEL_PROVIDER` | Uso |
|---|---|
| `scripted` | Testes e avaliações. Determinístico, sem rede e sem chave. |
| `anthropic` | Desenvolvimento local com `ANTHROPIC_API_KEY`. |
| `bedrock` | Produção. Credencial por IAM role, `BEDROCK_MODEL_ID`. |

Trocar de provider ou de versão do modelo não altera uma linha de código. É o que
torna rollback de modelo uma mudança de variável de ambiente.

## Prompt versionado

O prompt vive em `prompts.py` com uma versão explícita (`PROMPT_VERSION`). Mudou
o prompt, muda a versão, a suite de avaliação roda contra ela, e o rollback é
apontar a variável de volta para a versão anterior — sem rebuild da imagem.

## Controle de custo

- `MAX_TOKENS_PER_REQUEST` limita a geração.
- `MAX_TOOL_CALLS_PER_TURN` corta o loop se o modelo insistir em chamar ferramentas.
  O corte é determinístico, fora da decisão do modelo.
- `MAX_HISTORY_MESSAGES` limita a janela de contexto reenviada a cada turno.
- O evento `done` devolve `usage` com tokens de entrada e saída por turno.

## Streaming

`POST /v1/chat/stream` responde SSE com quatro eventos:

| Evento | Conteúdo |
|---|---|
| `ready` | ferramentas visíveis, versão do prompt, modelo |
| `tool_call` | nome e id de cada ferramenta chamada |
| `token` | fragmento de texto |
| `done` | latência, chamadas, `stop_reason`, `usage` |

## Executar

```bash
uv venv --python 3.12 && uv pip install -e ".[dev]" --group dev
.venv/bin/uvicorn sinal_agent.main:app --port 8083 --reload
```

## Testes

```bash
.venv/bin/python -m pytest
```

26 testes (91%): loop do agente, repasse de identidade, orçamento de ferramentas,
memória de sessão, seleção de provider, versionamento de prompt e a camada SSE
(incluindo falha que não vaza detalhe interno).

Ponta a ponta contra o MCP e a API reais: `python infra/smoke/agent-e2e.py`.
