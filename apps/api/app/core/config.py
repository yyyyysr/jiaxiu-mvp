from pathlib import Path
from typing import Annotated, Self

from pydantic import (
    Field,
    HttpUrl,
    SecretStr,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    database_path: Path = Path(__file__).resolve().parents[4] / "data" / "jiaxiu_tiyong.sqlite"
    facsimile_root: Path = Path(__file__).resolve().parents[4] / "data" / "facsimiles"
    app_database_path: Path = Path(__file__).resolve().parents[4] / "data" / "jiaxiu_app.sqlite"
    submission_root: Path = Path(__file__).resolve().parents[4] / "data" / "submissions"
    session_cookie_secure: bool = True
    session_ttl_seconds: int = 60 * 60 * 8
    login_rate_limit_failures: int = Field(default=8, ge=1, le=100)
    login_rate_limit_window_seconds: float = Field(default=60.0, gt=0, le=3600)
    login_rate_limit_max_clients: int = Field(default=4096, ge=1, le=100_000)
    model_base_url: HttpUrl | None = None
    model_api_key: SecretStr | None = None
    model_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
        | None
    ) = "gpt-4.1-mini"
    agent_rate_limit_requests: int = Field(default=8, ge=1, le=100)
    agent_rate_limit_window_seconds: float = Field(default=60.0, gt=0, le=3600)
    agent_rate_limit_max_clients: int = Field(default=1024, ge=1, le=100_000)
    cors_allowed_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_prefix="JIAXIU_",
        extra="ignore",
        hide_input_in_errors=True,
    )

    @field_validator("model_base_url", "model_api_key", "model_name", mode="before")
    @classmethod
    def empty_model_values_are_disabled(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("model_base_url")
    @classmethod
    def provider_url_is_a_safe_base(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is None:
            return None
        if value.username is not None or value.password is not None:
            raise ValueError("Provider base URL must not include user information")
        if value.query is not None or value.fragment is not None:
            raise ValueError("Provider base URL must not include a query or fragment")
        if value.path.rstrip("/").casefold().endswith("/chat/completions"):
            raise ValueError("Provider base URL must not include the completion endpoint")
        return value

    @field_validator("model_api_key")
    @classmethod
    def provider_key_is_bounded(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        secret = value.get_secret_value()
        if len(secret) > 4096 or "\r" in secret or "\n" in secret:
            raise ValueError("Provider API key is invalid")
        return value

    @model_validator(mode="after")
    def keyed_provider_configuration_is_complete(self) -> Self:
        if self.model_api_key is not None and (
            self.model_base_url is None or self.model_name is None
        ):
            raise ValueError("A configured model key requires both base URL and model name")
        return self

    @property
    def model_enabled(self) -> bool:
        return all((self.model_base_url, self.model_api_key, self.model_name))
