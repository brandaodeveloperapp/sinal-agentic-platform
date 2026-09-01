"""Model provider selection.

The provider and the model identifier are configuration, never code. Switching from
Anthropic to Bedrock, or changing the model version, is an environment variable
change: no execution path depends on the provider.
"""

from typing import TYPE_CHECKING

from sinal_agent.config import Settings

if TYPE_CHECKING:
    from strands.models.model import Model


def build_model(settings: Settings) -> "Model":
    """Instantiate the configured provider."""
    if settings.model_provider == "scripted":
        from sinal_agent.models.scripted import ScriptedModel

        return ScriptedModel(
            config={"model_id": "scripted", "max_tokens": settings.max_tokens_per_request}
        )

    if settings.model_provider == "anthropic":
        from strands.models.anthropic import AnthropicModel

        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY missing for model_provider=anthropic")
        return AnthropicModel(
            client_args={"api_key": settings.anthropic_api_key},
            model_id=settings.model_id,
            max_tokens=settings.max_tokens_per_request,
        )

    from strands.models.bedrock import BedrockModel

    return BedrockModel(
        region_name=settings.aws_region,
        model_id=settings.bedrock_model_id,
        max_tokens=settings.max_tokens_per_request,
    )


def describe_model(settings: Settings) -> dict[str, str]:
    """Model identification for logs, traces and the diagnostics endpoint."""
    model_id = {
        "scripted": "scripted",
        "anthropic": settings.model_id,
        "bedrock": settings.bedrock_model_id,
    }[settings.model_provider]
    return {"provider": settings.model_provider, "model_id": model_id}
