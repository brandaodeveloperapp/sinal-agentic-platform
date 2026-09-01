# One security group per tier. The chain is enforced at the network edge, mirroring
# the k8s NetworkPolicy: only the ALB reaches the BFF, only the BFF reaches the agent,
# only the agent reaches the MCP server, and only the MCP server reaches the API.

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public entry to the gateway"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from the internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "service" {
  for_each    = var.services
  name        = "${local.name}-${each.key}"
  description = "Service ${each.key}"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# BFF accepts traffic only from the ALB.
resource "aws_security_group_rule" "bff_from_alb" {
  type                     = "ingress"
  security_group_id        = aws_security_group.service["bff"].id
  from_port                = var.services["bff"].port
  to_port                  = var.services["bff"].port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
}

# Each internal hop accepts traffic only from the single service in front of it.
locals {
  service_chain = {
    agent       = "bff"
    mcp-server  = "agent"
    api-telecom = "mcp-server"
  }
}

resource "aws_security_group_rule" "internal_chain" {
  for_each                 = local.service_chain
  type                     = "ingress"
  security_group_id        = aws_security_group.service[each.key].id
  from_port                = var.services[each.key].port
  to_port                  = var.services[each.key].port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.service[each.value].id
}
