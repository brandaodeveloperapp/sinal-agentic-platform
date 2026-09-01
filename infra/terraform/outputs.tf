output "vpc_id" {
  value       = aws_vpc.main.id
  description = "The platform VPC."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnets where the ECS services run."
}

output "ecr_repository_urls" {
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
  description = "Where each service image is pushed."
}

output "cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "The ECS cluster hosting the services."
}

output "log_groups" {
  value       = { for name, group in aws_cloudwatch_log_group.service : name => group.name }
  description = "CloudWatch log group per service."
}
