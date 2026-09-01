# Container registry, one repository per service.
resource "aws_ecr_repository" "service" {
  for_each             = var.services
  name                 = "sinal/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment != "prd"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Secrets: the workload key and the two signing secrets live in Secrets Manager and are
# injected into tasks at run time, never baked into an image or a task definition.
resource "aws_secretsmanager_secret" "workload_key" {
  name = "${local.name}/workload-key"
}

resource "aws_secretsmanager_secret" "downstream_secret" {
  name = "${local.name}/downstream-secret"
}

resource "aws_secretsmanager_secret" "session_secret" {
  name = "${local.name}/session-secret"
}

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = var.services
  name              = "/sinal/${var.environment}/${each.key}"
  retention_in_days = var.environment == "prd" ? 30 : 7
}

# Execution role: pull images and read secrets at task start.
data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.workload_key.arn,
      aws_secretsmanager_secret.downstream_secret.arn,
      aws_secretsmanager_secret.session_secret.arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# One task role per service, least privilege. Only the agent may invoke Bedrock; the
# agent reaches the model through this role, never through a static API key.
resource "aws_iam_role" "task" {
  for_each           = var.services
  name               = "${local.name}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

data "aws_iam_policy_document" "agent_bedrock" {
  statement {
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/${var.bedrock_model_id}"]
  }
}

resource "aws_iam_role_policy" "agent_bedrock" {
  name   = "invoke-bedrock"
  role   = aws_iam_role.task["agent"].id
  policy = data.aws_iam_policy_document.agent_bedrock.json
}
