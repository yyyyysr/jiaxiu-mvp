from pathlib import Path

from app.core.config import Settings


def test_settings_resolve_the_repository_env_file() -> None:
    assert Settings.model_config["env_file"] == Path(__file__).resolve().parents[3] / ".env"
