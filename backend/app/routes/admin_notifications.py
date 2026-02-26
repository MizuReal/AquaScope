from __future__ import annotations

from email.message import EmailMessage
import html
import logging
from pathlib import Path
import re
import smtplib
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services.supabase_client import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)

_DEACTIVATION_TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "deactivation.html"
_FALLBACK_TEMPLATE_HTML = (
    "<html><body><p>Hello {{display_name}},</p><p>Your AquaScope account has been disabled.</p>"
    "<p>Reason: {{reason_html}}</p></body></html>"
)


def _extract_title_tag(html_text: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    return (match.group(1).strip() if match else "<no-title>")[:120]


def _load_deactivation_template_html() -> tuple[str, str]:
    template_path = _DEACTIVATION_TEMPLATE_PATH
    exists = template_path.exists()
    logger.info(
        "[admin_notifications] template lookup path=%s exists=%s",
        str(template_path),
        exists,
    )

    try:
        template_html = template_path.read_text(encoding="utf-8")
        logger.info(
            "[admin_notifications] template loaded source=file title=%s chars=%d",
            _extract_title_tag(template_html),
            len(template_html),
        )
        return template_html, "file"
    except FileNotFoundError:
        logger.warning(
            "[admin_notifications] template missing, using fallback source=inline path=%s",
            str(template_path),
        )
        return _FALLBACK_TEMPLATE_HTML, "fallback"
    except Exception:
        logger.exception(
            "[admin_notifications] template read failure, using fallback source=inline path=%s",
            str(template_path),
        )
        return _FALLBACK_TEMPLATE_HTML, "fallback"


class DeactivationEmailRequest(BaseModel):
    target_user_id: str = Field(..., min_length=5)
    admin_user_id: str = Field(..., min_length=5)
    reason: str = Field(..., min_length=5, max_length=1200)


class DeactivationEmailResponse(BaseModel):
    success: bool
    message: str


def _extract_user_id_from_auth_response(response: Any) -> Optional[str]:
    if not response:
        return None

    user_obj = getattr(response, "user", None)
    if user_obj is not None:
        user_id = getattr(user_obj, "id", None)
        if user_id:
            return str(user_id)

    if isinstance(response, dict):
        user = response.get("user") if isinstance(response.get("user"), dict) else {}
        user_id = user.get("id")
        if user_id:
            return str(user_id)

    return None


def _extract_email_from_admin_lookup(response: Any) -> Optional[str]:
    if not response:
        return None

    user_obj = getattr(response, "user", None)
    if user_obj is not None:
        email = getattr(user_obj, "email", None)
        if email:
            return str(email)

    if isinstance(response, dict):
        user = response.get("user") if isinstance(response.get("user"), dict) else {}
        email = user.get("email")
        if email:
            return str(email)

    return None


def _extract_role_from_profile_row(row: Any) -> int:
    if isinstance(row, dict):
        return int(row.get("role") or 0)
    return int(getattr(row, "role", 0) or 0)


def _extract_display_name(row: Any) -> str:
    if isinstance(row, dict):
        return str(row.get("display_name") or "AquaScope user")
    return str(getattr(row, "display_name", "AquaScope user") or "AquaScope user")


def _build_email_html(display_name: str, reason: str) -> str:
    safe_name = html.escape(display_name)
    safe_reason = html.escape(reason).replace("\n", "<br/>")
    template_html, source = _load_deactivation_template_html()
    rendered = (
        template_html
        .replace("{{display_name}}", safe_name)
        .replace("{{reason_html}}", safe_reason)
    )
    logger.info(
        "[admin_notifications] template rendered source=%s has_display_name_placeholder=%s has_reason_placeholder=%s",
        source,
        "{{display_name}}" in template_html,
        "{{reason_html}}" in template_html,
    )
    return rendered


@router.post("/notify-user-deactivated", response_model=DeactivationEmailResponse)
def notify_user_deactivated(
    body: DeactivationEmailRequest,
    authorization: Optional[str] = Header(default=None),
) -> DeactivationEmailResponse:
    settings = get_settings()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase admin client is not configured.")

    if not settings.smtp_host or not settings.smtp_user or not settings.smtp_pass or not settings.smtp_from:
        raise HTTPException(status_code=500, detail="SMTP credentials are not configured on the backend.")

    token = (authorization or "").replace("Bearer", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token.")

    try:
        requester_info = supabase.auth.get_user(token)
    except Exception as exc:
        logger.exception("Failed to validate requester token")
        raise HTTPException(status_code=401, detail="Unable to validate requester session.") from exc

    requester_id = _extract_user_id_from_auth_response(requester_info)
    if not requester_id or requester_id != body.admin_user_id:
        raise HTTPException(status_code=403, detail="Requester identity mismatch.")

    try:
        admin_profile = (
            supabase.table("profiles")
            .select("id, role")
            .eq("id", body.admin_user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to load requester profile role")
        raise HTTPException(status_code=500, detail="Unable to verify admin role.") from exc

    admin_rows = admin_profile.data or []
    if not admin_rows or _extract_role_from_profile_row(admin_rows[0]) != 1:
        raise HTTPException(status_code=403, detail="Only admins can send deactivation notices.")

    reason = body.reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Please provide a clear deactivation reason.")

    try:
        target_user = supabase.auth.admin.get_user_by_id(body.target_user_id)
    except Exception as exc:
        logger.exception("Failed to load target user from auth")
        raise HTTPException(status_code=500, detail="Unable to load target user email.") from exc

    target_email = _extract_email_from_admin_lookup(target_user)
    if not target_email:
        raise HTTPException(status_code=404, detail="Target user email not found.")

    try:
        profile_lookup = (
            supabase.table("profiles")
            .select("display_name")
            .eq("id", body.target_user_id)
            .limit(1)
            .execute()
        )
        profile_rows = profile_lookup.data or []
        display_name = _extract_display_name(profile_rows[0]) if profile_rows else "AquaScope user"
    except Exception:
        display_name = "AquaScope user"

    html_body = _build_email_html(display_name=display_name, reason=reason)
    text_body = (
        f"Hello {display_name},\n\n"
        "Your AquaScope account has been temporarily disabled by an administrator.\n\n"
        f"Reason provided: {reason}\n\n"
        "If you believe this action was made in error, please contact AquaScope support."
    )

    message = EmailMessage()
    message["Subject"] = "AquaScope account disabled"
    message["From"] = settings.smtp_from
    message["To"] = target_email
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        if settings.smtp_secure:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
                smtp.login(settings.smtp_user, settings.smtp_pass)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                smtp.login(settings.smtp_user, settings.smtp_pass)
                smtp.send_message(message)
    except Exception as exc:
        logger.exception("Failed to send deactivation email")
        raise HTTPException(status_code=502, detail="Failed to send deactivation email.") from exc

    return DeactivationEmailResponse(success=True, message="Deactivation email sent successfully.")
