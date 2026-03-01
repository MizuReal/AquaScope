from pathlib import Path
import logging
import os
import sys

# Print immediately so the deploy platform knows the process is alive
print("Starting ML-AAW backend...", flush=True)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.routes.ocr import router as ocr_router
from app.routes.fiducial import router as fiducial_router
from app.routes.predict import router as predict_router
from app.routes.microbial_risk import router as microbial_router
from app.routes.chat import router as chat_router
from app.routes.container import router as container_router
from app.routes.export import router as export_router
from app.routes.admin_notifications import router as admin_notifications_router

# Default app logging (keeps request logs, avoids verbose third-party HTTP debug traces)
logging.basicConfig(level=logging.INFO)
logging.getLogger("app.routes.fiducial").setLevel(logging.DEBUG)
logging.getLogger("groq").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

settings = get_settings()

app = FastAPI(title="ML App Backend")

allowed_origins = [
	origin.strip()
	for origin in os.getenv(
		"BACKEND_CORS_ORIGINS",
		# Defaults cover localhost dev servers. For LAN / deployed access, set
		# BACKEND_CORS_ORIGINS in your backend .env, e.g.:
		#   BACKEND_CORS_ORIGINS=http://192.168.100.112:5173,http://192.168.100.112:3000
		# Or set FRONTEND_URL to a single additional allowed origin:
		#   FRONTEND_URL=http://192.168.100.112:5173
		"http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173",
	).split(",")
	if origin.strip()
]

# Also accept FRONTEND_URL as a convenience single-origin override
_frontend_url = os.getenv("FRONTEND_URL", "").strip()
if _frontend_url and _frontend_url not in allowed_origins:
	allowed_origins.append(_frontend_url)

app.add_middleware(
	CORSMiddleware,
	allow_origins=allowed_origins,
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


_CONFIRM_TEMPLATE_PATH = (
	Path(__file__).resolve().parent / "templates" / "auth_confirmed.html"
)
try:
	CONFIRMED_HTML = _CONFIRM_TEMPLATE_PATH.read_text(encoding="utf-8")
except FileNotFoundError:
	CONFIRMED_HTML = """<!DOCTYPE html><html><body><p>Email confirmed. You can close this page.</p></body></html>"""


@app.api_route("/health", methods=["GET", "HEAD"], tags=["health"])
def health_check() -> dict:
	return {"status": "ok"}


@app.api_route("/", methods=["GET", "HEAD"], tags=["health"])
def root() -> dict:
	return {"status": "ok", "service": "ml-aaw-backend"}


@app.get("/auth/confirmed", response_class=HTMLResponse, tags=["auth"])
async def email_confirmed(request: Request) -> HTMLResponse:
	"""Simple confirmation page Supabase can redirect to after email verification.

	This does not perform any auth logic; Supabase has already confirmed the user
	by the time it redirects. This just shows a friendly message.
	"""

	return HTMLResponse(content=CONFIRMED_HTML)


def get_app() -> FastAPI:
	"""Convenience accessor if you need the app instance elsewhere."""
	return app


app.include_router(ocr_router, prefix="/ocr", tags=["ocr"])
app.include_router(fiducial_router, prefix="/fiducial", tags=["fiducial"])
app.include_router(predict_router, prefix="/predict", tags=["predict"])
app.include_router(microbial_router, prefix="/predict", tags=["microbial-risk"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(container_router, prefix="/container", tags=["container"])
app.include_router(export_router, prefix="/export", tags=["export"])
app.include_router(admin_notifications_router, prefix="/admin", tags=["admin"])

# ── Startup diagnostics ──────────────────────────────────────────────
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def _log_routes() -> None:
    routes = [r.path for r in app.routes if hasattr(r, "methods")]
    logger.info("=" * 60)
    logger.info("STARTUP: Registered API routes (%d):", len(routes))
    for path in sorted(routes):
        logger.info("  -> %s", path)
    # Explicitly check for the container route
    container_paths = [p for p in routes if "container" in p]
    if container_paths:
        logger.info("✓ Container route(s) found: %s", container_paths)
    else:
        logger.warning("✕ /container/analyze NOT registered — check import or include_router")
    logger.info("=" * 60)


@app.middleware("http")
async def _request_logger(request: Request, call_next):
    logger.info(">> %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("<< %s %s -> %s", request.method, request.url.path, response.status_code)
    return response

