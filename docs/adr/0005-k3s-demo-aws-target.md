# ADR-0005 — k3s for the demo, AWS as the production target

**Status:** accepted

## Context

The case asks for an AWS deployment strategy. Standing up billed AWS infrastructure for
a case is wasteful, and a reviewer cannot verify a deploy in a private account anyway.

## Decision

Run the live, clickable demo on an existing k3s cluster; express the production target
as validated Terraform for AWS (ECS Fargate, ECR, ALB/API GW, Secrets Manager,
CloudWatch, per-service IAM, Bedrock via role). Document the object-by-object parity.

## Consequences

- A reviewer gets a working demo and a real IaC artifact, without a billed account.
- The same isolation property is verified in the demo (NetworkPolicy) and declared in
  Terraform (security-group chain).
- Cost: no `apply` is exercised in CI; `validate`/`plan` is the guarantee. The parity
  table is what keeps the two from drifting.
