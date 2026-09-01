"""Runtime configuration loaded from the environment."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings for the Onda Telecom API service."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "dev"
    log_level: str = "info"
    service_name: str = "sinal-api-telecom"

    api_keys: str = "dev-mcp-server-key"
    latency_floor_ms: int = 15
    latency_ceiling_ms: int = 90

    otel_exporter_otlp_endpoint: str = ""
    otel_service_namespace: str = "sinal"

    @property
    def allowed_api_keys(self) -> frozenset[str]:
        return frozenset(k.strip() for k in self.api_keys.split(",") if k.strip())


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.environment != "dev" and "dev-mcp-server-key" in settings.allowed_api_keys:
        raise RuntimeError(
            f"API_KEYS still holds its development default while ENVIRONMENT={settings.environment}"
        )
    return settings
