"""Agent configuration loaded from the environment."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime parameters for the agent."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["dev", "hom", "prd"] = "dev"
    log_level: str = "info"
    service_name: str = "sinal-agent"
    port: int = 8083

    model_provider: Literal["anthropic", "bedrock", "scripted"] = "scripted"
    model_id: str = "claude-sonnet-5"
    bedrock_model_id: str = "us.anthropic.claude-sonnet-5-v1:0"
    aws_region: str = "us-east-1"
    anthropic_api_key: str = ""

    jwt_issuer: str = "https://sinal.local/idp"
    jwt_audience: str = "sinal-mcp"
    downstream_secret: str = "dev-only-signing-secret-change-me"  # noqa: S105

    redis_url: str = ""

    mcp_server_url: str = "http://localhost:8082/mcp"
    mcp_startup_timeout_s: int = 15

    max_tokens_per_request: int = 4096
    max_tool_calls_per_turn: int = 6
    max_history_messages: int = 20
    session_ttl_s: int = 1800

    prompt_version: str = "v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
