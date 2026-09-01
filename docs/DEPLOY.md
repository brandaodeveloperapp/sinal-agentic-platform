# Deploy

**The production target is AWS.** The live demo runs on k3s because it costs nothing to
keep up and a reviewer can click it today; the AWS design is captured as Terraform in
`infra/terraform` and validated in CI. This document is the strategy, the parity, and
the operational story (rollback, cost, regression) that the case asks for.

## Request flow on AWS

![Sinal on AWS — one request end to end](diagrams/aws-request-flow.svg)

## AWS topology

- **Network** — a VPC across two availability zones, public subnets for the load
  balancer and NAT, private subnets for every service. Nothing but the ALB is reachable
  from the internet.
- **Compute** — each service runs on **ECS Fargate**, two tasks per service across the
  two AZs. Images come from **ECR** (immutable tags, scan on push).
- **Edge** — **CloudFront + WAF** terminate TLS and absorb the public surface; **ALB +
  API Gateway** route to the BFF only.
- **Identity of the model** — the agent reaches **Bedrock** through an IAM task role
  scoped to a single model, never a static API key.
- **Secrets** — the workload key and the two signing secrets live in **Secrets Manager**
  and are injected into tasks at start by the execution role; they are never baked into
  an image or a task definition.
- **Isolation** — one security group per tier enforces the chain ALB → BFF → agent →
  MCP → API; each hop only accepts traffic from the one in front of it.
- **Observability** — one **CloudWatch** log group per service; OpenTelemetry spans via
  an ADOT collector. See `OBSERVABILITY.md`.

`infra/terraform` declares the VPC, subnets, security groups, ECR repositories, the ECS
cluster, the log groups, the Secrets Manager entries and the per-service IAM roles.
`terraform init`, `fmt -check` and `validate` run in CI.

## Parity: the demo on k3s ↔ the AWS target

This is why the demo running on k3s is an argument, not a gap — every object maps
cleanly to its AWS equivalent, so the same architecture runs in both.

| Concern | k3s demo (live today) | AWS target |
|---|---|---|
| Compute | Deployment / Pod | ECS Fargate task |
| Image registry | in-cluster registry `:5000` | ECR |
| Public entry | host nginx + Let's Encrypt | CloudFront + WAF + ALB/API GW |
| Internal exposure | ClusterIP / NodePort | security groups + service discovery |
| Network isolation | NetworkPolicy (API accepts only MCP) | security group per tier (same chain) |
| Secrets | k8s Secret | Secrets Manager |
| Model credential | env for dev; Bedrock in the design | IAM task role → Bedrock |
| Logs | stdout JSON | CloudWatch Logs |
| Tracing | OTLP endpoint | ADOT collector → X-Ray / CloudWatch |
| Config per env | namespace + env | account/VPC per environment, Terraform workspace |

The network isolation is not just described in both — it is *verified* in both: the
NetworkPolicy is proven in-cluster (a probe from another namespace cannot reach the
API), and the security-group chain is declared in Terraform.

## Environments

`dev` / `hom` / `prd` are segregated. Every service refuses to boot outside `dev` while
a secret still holds its development default, and the dev-only token issuer is not
registered outside `dev` (verified: 404 in the deployed `hom`). In AWS this is an
account or VPC per environment, driven by the same Terraform with a workspace per
environment.

## Rollback

- **Model rollback** — the provider and model id are configuration (`MODEL_PROVIDER`,
  `BEDROCK_MODEL_ID`). Pointing them back is an environment change, no code and no image
  rebuild. In production these live in Parameter Store / task environment, so the switch
  is a task-definition revision.
- **Prompt rollback** — the prompt is a versioned artifact (`PROMPT_VERSION`). Rolling
  back is pointing the variable at the previous version; the evaluation suite is what
  tells you the previous version was good.
- **Image rollback** — images are immutable and tagged by commit SHA; a rollback is
  deploying the previous task definition. Canary by target-group weight lets a new
  revision take a slice of traffic first.

## Cost control (FinOps for GenAI)

- A **token ceiling per request** and a **tool-call ceiling per turn** bound the cost of
  any single conversation, enforced in code outside the model's decision.
- Every turn reports its `usage`, so per-request model cost is a first-class metric.
- Fargate scales to the two-AZ baseline and out on demand; the model, not the compute,
  is the dominant cost, which is why the ceilings sit on the model path.
- Model routing is a config seam: a cheap model can serve cheap routes and an expensive
  one the hard routes, without touching code.

## Regression mitigation

- **Behavioural regressions** — the golden suite (`evals/`) runs in CI as a gate: if a
  case that used to pass now fails, or the pass rate drops below the blessed baseline,
  the build fails. This covers a change in prompt, tool or model with one mechanism.
- **Security regressions** — the live red-team harness runs in CI against the booted
  stack and must refuse every attack.
- **Contract regressions** — the exported OpenAPI is checked for drift against the code.
- **Functional regressions** — unit suites per service plus the no-mock full-chain smoke.

## Deploying the demo (k3s)

`infra/deploy-vps.sh` builds the images on the VPS (amd64), pushes to the in-cluster
registry, applies the manifests in `infra/k8s`, generates the secrets in-cluster on
first run, and cleans up stale images. The MCP endpoint is published at
`https://sinal.brandaodeveloper.com.br/mcp` through the host nginx with TLS.
