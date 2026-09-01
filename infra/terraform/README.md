# infra/terraform

The AWS target infrastructure for Sinal, as code. It is the production deployment the
case asks for; the live demo runs on k3s (see `docs/DEPLOY.md` for why and for the
service-by-service equivalence).

`terraform validate` and `terraform fmt -check` run in CI, so the module stays correct
even without an apply.

## What it declares

- A VPC across two AZs with public and private subnets and NAT egress.
- One security group per tier enforcing the same chain as the k8s NetworkPolicy: ALB →
  BFF → agent → MCP → API, each hop reachable only from the one in front of it.
- An ECR repository per service (immutable tags, scan on push).
- An ECS Fargate cluster with a CloudWatch log group per service.
- Secrets Manager entries for the workload key and the two signing secrets, read by the
  execution role at task start — never baked into an image.
- A least-privilege task role per service; only the agent's role may invoke Bedrock, so
  the model is reached through IAM, not a static key.

## Use

```bash
terraform init
terraform plan -var environment=hom
```

Images are built and pushed to the ECR URLs in the outputs; task definitions and the
ALB/API-Gateway wiring for a real apply live in the environment overlay, kept out of
this base module.
