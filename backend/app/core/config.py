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

		# Gmail API
		self.gmail_client_id: str = os.getenv("GMAIL_CLIENT_ID", "")
		self.gmail_client_secret: str = os.getenv("GMAIL_CLIENT_SECRET", "")
		self.gmail_refresh_token: str = os.getenv("GMAIL_REFRESH_TOKEN", "")
		self.gmail_sender_email: str = os.getenv("GMAIL_SENDER_EMAIL", "")

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

