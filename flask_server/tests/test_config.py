"""Configuration security regression tests."""

import importlib.util
from pathlib import Path

import pytest


CONFIG_PATH = Path(__file__).resolve().parents[1] / "app" / "config.py"


@pytest.mark.parametrize("missing_name", ["SECRET_KEY", "SECURITY_PASSWORD_SALT"])
def test_config_rejects_empty_session_signing_secrets(monkeypatch, missing_name):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("SECURITY_PASSWORD_SALT", "test-password-salt")
    monkeypatch.setenv(missing_name, "")

    spec = importlib.util.spec_from_file_location("config_without_secret_key", CONFIG_PATH)
    config = importlib.util.module_from_spec(spec)

    with pytest.raises(RuntimeError, match=rf"{missing_name} must be set"):
        spec.loader.exec_module(config)


def test_explicit_test_session_signing_secrets_load_config(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("SECURITY_PASSWORD_SALT", "test-password-salt")

    spec = importlib.util.spec_from_file_location("config_with_test_secrets", CONFIG_PATH)
    config = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config)

    assert config.SECRET_KEY == "test-secret-key"
    assert config.SECURITY_PASSWORD_SALT == "test-password-salt"
