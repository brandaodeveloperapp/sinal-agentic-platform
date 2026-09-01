# ECS Service Auto Scaling — the AWS equivalent of the k3s HorizontalPodAutoscaler.
# Each service tracks CPU utilisation and scales its task count between a floor and a
# ceiling. The resource_id references the service by name under the cluster; the
# service and task definitions live in the environment overlay, so this base module
# declares the scaling intent without owning the service resource.

locals {
  autoscale = {
    bff         = { min = 2, max = 6, target_cpu = 70 }
    agent       = { min = 2, max = 8, target_cpu = 65 }
    mcp-server  = { min = 1, max = 4, target_cpu = 70 }
    api-telecom = { min = 2, max = 4, target_cpu = 70 }
  }
}

resource "aws_appautoscaling_target" "service" {
  for_each           = local.autoscale
  max_capacity       = each.value.max
  min_capacity       = each.value.min
  resource_id        = "service/${aws_ecs_cluster.main.name}/sinal-${each.key}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.autoscale
  name               = "sinal-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = each.value.target_cpu
    scale_in_cooldown  = 180
    scale_out_cooldown = 30
  }
}
