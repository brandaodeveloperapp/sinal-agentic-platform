# sinal-web

Conversational UI in React and TypeScript, styled as a familiar chat (WhatsApp-like:
teal header, wallpaper thread, green outgoing bubbles with delivery ticks and time,
white incoming bubbles). It signs the user in against the gateway and renders the
agent answer as it streams.

## Why not EventSource

The browser `EventSource` API only issues `GET` requests and cannot carry an
`Authorization` header, so the stream is read from `fetch` and framed by hand in
`src/api/sse.ts`. Chunk boundaries never align with frame boundaries, so the parser
buffers and only emits complete frames — that parser is unit tested against split
payloads, multi-line data and trailing frames.

## The session token lives in memory only

Nothing is written to `localStorage` or `sessionStorage`. A script injected into the
page finds no persisted credential, and closing the tab ends the session. The
tradeoff is deliberate and visible: reloading the page asks for sign-in again.

## What the UI shows

Beyond the answer itself, the interface surfaces what the platform is doing:

| Element | Source |
|---|---|
| Header subtitle "N tools available to you" | `ready` event — reflects the caller scopes |
| "used <tool>" chip above an answer | `tool_call` events — which capability was used |
| Tokens, latency, stop reason under a bubble | `done` event — per-turn cost |

That makes authorization visible in the product: a subscriber and an attendant see
different tool lists on the same screen.

## Design system

Every colour, space, radius, shadow and duration lives in `src/styles/tokens.css`.
Components never hardcode a value, so retargeting the interface to another carrier
brand is one file. Light and dark palettes are both defined there and follow the
system setting.

## Accessibility

The streaming region is an `aria-live="polite"` container marked `aria-busy` while
the turn runs, every control has a label, focus rings are preserved, and the typing
cursor animation is disabled under `prefers-reduced-motion`. Light and dark themes
follow the system setting.

## Run

```bash
npm install
npm run dev
```

Set `VITE_BFF_URL` if the gateway is not at `http://localhost:8080`. The variable is
read at build time, so the Docker image takes it as a build argument.

## Tests

```bash
npm test
```

32 tests: the SSE parser against awkward chunk boundaries and both LF and CRLF
line endings, sign-in success and failure, streamed assembly of an answer from
token frames, tool badges, per-turn cost, session id stability across turns,
suggestion chips, Enter to send and Shift+Enter for a new line, and the three
failure paths the user can actually hit — rate limit, expired session and an agent
error frame.
