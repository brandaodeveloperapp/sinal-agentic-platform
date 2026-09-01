# Risks

The honest risks in a system like this, and what holds each one down. This is the list
a reviewer should probe; each row names the mitigation that exists in the code and the
residual that remains.

## Prompt injection

**Risk:** a customer plants an instruction in a free-text field (a ticket body, a name)
that the model later reads and obeys — asking it to call a tool or leak another
customer's data.

**Mitigation:** the injection cannot escalate authority, because the agent forwards the
user's own token and every tool call is authorized against it — the model cannot reach
data the user can't. Untrusted free text is sanitized at the MCP boundary (NFKC
normalize, strip zero-width/control, collapse whitespace, neutralize markers), proven on
the live path: a real injection stored in a ticket reaches the model as
`[content removed]`.

**Residual:** the write confirmation is still a model-set flag. It is bounded (bound to
the token's customer, not retried, summary sanitized), but a server-issued approval
nonce is the next step — tracked in `security/FINDINGS.md`.

## The model does the wrong thing

**Risk:** the model routes to the wrong tool, invents a figure, or over-calls tools.

**Mitigation:** grounding and routing are pinned by the golden suite, which fails CI on
regression; a token ceiling and a tool-call ceiling bound a runaway turn in code; the
answer's cost is surfaced and logged.

**Residual:** the suite is only as good as its cases; new behaviours need new cases
before they are protected. The suite is designed to be extended.

## Secret exposure

**Risk:** a leaked signing secret forges tokens; a leaked session token is replayed.

**Mitigation:** two secrets and two audiences mean a session token cannot be replayed at
the MCP server; downstream tokens live five minutes and are re-resolved from the
directory; every service refuses to boot on a dev-default secret outside `dev`; secrets
live in Secrets Manager, injected at task start, never committed.

**Residual:** the demo uses a shared password and Node-default scrypt cost; both are
noted for replacement with per-user credentials and stronger parameters.

## Upstream failure and duplicate side effects

**Risk:** the corporate API is slow or flaky; a retried write creates duplicate tickets.

**Mitigation:** per-attempt timeout, retry with backoff and jitter only on idempotent
GETs, and a circuit breaker per upstream. POST is never retried, so a slow write cannot
duplicate. Failures reach the model as fixed, safe strings, never a stack trace.

**Residual:** true idempotency keys on writes would let a POST retry safely; today the
choice is to not retry rather than to dedupe.

## Cost blow-up

**Risk:** the model is the dominant cost; a flood or a long conversation runs it up.

**Mitigation:** per-request token ceiling and per-turn tool-call ceiling in code; login
and chat rate limits; per-turn usage as a metric; model routing as a config seam.

**Residual:** a per-subject concurrent-stream cap is not yet in place (rate is limited,
concurrency is not) — tracked in `security/FINDINGS.md`.

## Availability and blast radius

**Risk:** one compromised or failing service takes down or exposes the rest.

**Mitigation:** four isolated processes; a security-group / NetworkPolicy chain so each
hop only accepts its predecessor; two tasks per service across two AZs in the AWS
target; the corporate API unreachable except from the MCP server (verified in-cluster).

**Residual:** the corporate API is the single system of record; its own resilience is
out of scope for this platform and assumed.

## Operational drift between demo and production

**Risk:** the k3s demo and the AWS target diverge and the "it works on the demo" claim
stops meaning anything.

**Mitigation:** the parity table in `DEPLOY.md` maps every object; Terraform is
validated in CI; the same isolation property is verified in the demo and declared in
Terraform.

**Residual:** a full AWS apply is not exercised in CI (no billed account); `terraform
validate`/`plan` is the guarantee, not `apply`.
