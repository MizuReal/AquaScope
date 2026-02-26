import os
from functools import lru_cache


class Settings:
	"""Simple settings loader that reads from environment variables.

	This keeps things straightforward for your project and avoids extra
	dependencies like pydantic-settings.
	"""

	def __init__(self) -> None:
		# Supabase
		self.supabase_url: str = os.getenv("SUPABASE_URL", "")
		self.supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
		self.supabase_samples_table: str = os.getenv("SUPABASE_SAMPLES_TABLE", "field_samples")

		# Database (only needed if you decide to use direct Postgres access)
		self.db_host: str = os.getenv("DB_HOST", "")
		self.db_port: int = int(os.getenv("DB_PORT", "5432"))
		self.db_name: str = os.getenv("DB_NAME", "")
		self.db_user: str = os.getenv("DB_USER", "")
		self.db_password: str = os.getenv("DB_PASSWORD", "")

		# Gemini / Groq
		self.groq_api_key: str = os.getenv("GROQ_API_KEY", "")

		# FastAPI app
		self.app_host: str = os.getenv("APP_HOST", "127.0.0.1")
		self.app_port: int = int(os.getenv("APP_PORT", "8000"))

		# SMTP
		self.smtp_host: str = os.getenv("SMTP_HOST", "")
		self.smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
		self.smtp_secure: bool = os.getenv("SMTP_SECURE", "false").lower() in {"1", "true", "yes"}
		self.smtp_user: str = os.getenv("SMTP_USER", "")
		self.smtp_pass: str = os.getenv("SMTP_PASS", "")
		self.smtp_from: str = os.getenv("SMTP_FROM", "")

	@property
	def database_url(self) -> str:
		"""Construct the SQLAlchemy-compatible Postgres URL from env pieces."""
		if not all([self.db_user, self.db_password, self.db_host, self.db_name]):
			return ""
		return (
			f"postgresql://{self.db_user}:{self.db_password}"
			f"@{self.db_host}:{self.db_port}/{self.db_name}"
		)


@lru_cache()
def get_settings() -> Settings:
	"""Return a cached Settings instance so we only read env once."""
	return Settings()

