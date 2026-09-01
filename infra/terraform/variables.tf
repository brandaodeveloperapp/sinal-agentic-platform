variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for the Sinal platform."
}

variable "environment" {
  type        = string
  default     = "hom"
  description = "Deployment environment (dev, hom, prd); drives isolation and secret names."

  validation {
    condition     = contains(["dev", "hom", "prd"], var.environment)
    error_message = "environment must be one of dev, hom, prd."
  }
}

variable "vpc_cidr" {
  type        = string
  default     = "10.20.0.0/16"
  description = "CIDR block for the platform VPC."
}

variable "bedrock_model_id" {
  type        = string
  default     = "us.anthropic.claude-sonnet-5-v1:0"
  description = "Bedrock model id the agent invokes in production."
}

variable "services" {
  type = map(object({
    port          = number
    cpu           = number
    memory        = number
    desired_count = number
    public        = bool
  }))
  description = "The four backend services placed on ECS Fargate."
  default = {
    api-telecom = { port = 8081, cpu = 256, memory = 512, desired_count = 2, public = false }
    mcp-server  = { port = 8082, cpu = 256, memory = 512, desired_count = 2, public = false }
    agent       = { port = 8083, cpu = 512, memory = 1024, desired_count = 2, public = false }
    bff         = { port = 8080, cpu = 256, memory = 512, desired_count = 2, public = true }
  }
}
