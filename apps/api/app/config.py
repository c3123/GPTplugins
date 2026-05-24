from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./dev.sqlite3"
    jwt_secret: str = "dev-secret-change-me"
    jwt_expires_minutes: int = 60 * 24 * 30
    login_code_expires_minutes: int = 10
    resend_api_key: str = ""
    email_from: str = "GPTplugins <no-reply@example.com>"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    dev_auth_codes: bool = True

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
