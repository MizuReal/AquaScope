"""Thin wrapper around the Groq SDK (Llama 3.3 70B) for water treatment chat."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parents[2] / ".env"  # backend/.env
    load_dotenv(_env_path, override=True)
except ImportError:
    pass  # python-dotenv not installed; rely on OS env

from groq import Groq, RateLimitError

logger = logging.getLogger(__name__)
logger.info("GROQ_API_KEY present after dotenv: %s", bool(os.getenv("GROQ_API_KEY")))

_MODEL = "llama-3.3-70b-versatile"
_MAX_RETRIES = 3
_INITIAL_BACKOFF = 5  # seconds

FILTRATION_SYSTEM_PROMPT = (
    "You are an expert water-treatment engineer. "
    "The user will provide water quality analysis results including microbial risk "
    "level, WHO threshold violations, detected bacteria, and parameter readings. "
    "Your job:\n"
    "1. Recommend the most appropriate WHO-recognised filtration / disinfection "
    "method(s) for the specific contaminants found.\n"
    "2. Briefly explain WHY each method works for those contaminants.\n"
    "3. Note any low-cost alternatives suitable for field or household use.\n"
    "4. If the water is already safe, say so clearly.\n"
    "Keep answers concise (≤200 words). Use bullet points. "
    "Cite WHO guideline names where relevant."
)

CONTAINER_CLEANING_SYSTEM_PROMPT = (
    "You are a senior water-sanitation operations advisor for container hygiene. "
    "The user provides a container scan result with one of these classes: "
    "Clean, LightMoss, MediumMoss, HeavyMoss, or an invalid/unrecognized result. "
    "Your job:\n"
    "1. Explain what the class implies in practical risk terms.\n"
    "2. Give clear step-by-step cleaning guidance tailored to that class.\n"
    "3. State when to keep using, deep-clean, or discard/replace the container.\n"
    "4. Include low-cost household options and a brief safety reminder.\n"
    "Keep responses concise (<=180 words), practical, and in bullet points."
)


_client_instance: Optional[Groq] = None


def _get_client() -> Groq:
    global _client_instance
    if _client_instance is not None:
        return _client_instance
    api_key = os.getenv("GROQ_API_KEY", "")
    logger.info("_get_client: GROQ_API_KEY length=%d", len(api_key))
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set in the environment")
    _client_instance = Groq(api_key=api_key)
    return _client_instance


def _call_with_retry(fn, *args, **kwargs):
    """Call *fn* and retry up to _MAX_RETRIES times on 429 rate-limit errors."""
    for attempt in range(_MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except RateLimitError as exc:
            if attempt < _MAX_RETRIES - 1:
                wait = _INITIAL_BACKOFF * (2 ** attempt)
                logger.warning("Groq 429 rate-limited, retrying in %ds (attempt %d/%d)", wait, attempt + 1, _MAX_RETRIES)
                time.sleep(wait)
            else:
                raise


def _build_water_context(analysis: Dict) -> str:
    """Turn the water analysis dict into a concise text block for the LLM."""
    lines: list[str] = []

    risk = analysis.get("microbialRiskLevel") or analysis.get("microbial_risk_level") or "unknown"
    score = analysis.get("microbialScore") or analysis.get("microbial_score") or "N/A"
    max_score = analysis.get("microbialMaxScore") or analysis.get("microbial_max_score") or 14
    lines.append(f"Microbial risk: {risk} (score {score}/{max_score})")

    violations = analysis.get("microbialViolations") or analysis.get("microbial_violations") or []
    if violations:
        lines.append("WHO threshold violations:")
        for v in violations:
            field = v.get("field", "?")
            rule = v.get("rule", "")
            value = v.get("value")
            unit = v.get("unit", "")
            val_str = f"{value:.2f} {unit}".strip() if value is not None else "N/A"
            health = v.get("healthRisk") or v.get("health_risk") or ""
            bacteria = ", ".join(v.get("bacteria", []))
            lines.append(f"  • {field}: {val_str} — {rule}")
            if health:
                lines.append(f"    Health risk: {health}")
            if bacteria:
                lines.append(f"    Associated bacteria: {bacteria}")

    bacteria_list = analysis.get("possibleBacteria") or analysis.get("possible_bacteria") or []
    if bacteria_list:
        lines.append(f"All possible bacteria: {', '.join(bacteria_list)}")

    # Parameter checks that are not "ok"
    checks = analysis.get("checks") or []
    flagged = [c for c in checks if (c.get("status") or "").lower() not in ("ok", "missing")]
    if flagged:
        lines.append("Flagged water quality parameters:")
        for c in flagged:
            label = c.get("label", c.get("field", "?"))
            status = c.get("status", "?")
            value = c.get("value")
            val_str = f"{value:.2f}" if isinstance(value, (int, float)) else "N/A"
            lines.append(f"  • {label}: {val_str} ({status})")

    potable = analysis.get("isPotable")
    if potable is not None:
        lines.append(f"Potability prediction: {'potable' if potable else 'not potable'}")

    return "\n".join(lines)


def _build_container_context(analysis: Dict) -> str:
    """Turn container-classification output into compact grounding context."""
    lines: list[str] = []

    predicted_class = analysis.get("predicted_class") or analysis.get("predictedClass") or "Unknown"
    is_valid = analysis.get("is_valid")
    confidence = analysis.get("confidence")
    entropy = analysis.get("entropy")
    margin = analysis.get("margin")
    rejection_reason = analysis.get("rejection_reason") or analysis.get("rejectionReason")

    lines.append(f"Predicted class: {predicted_class}")
    if isinstance(is_valid, bool):
        lines.append(f"Valid classification: {is_valid}")
    if isinstance(confidence, (int, float)):
        lines.append(f"Top-class confidence: {confidence:.3f}")
    if isinstance(entropy, (int, float)):
        lines.append(f"Entropy: {entropy:.3f}")
    if isinstance(margin, (int, float)):
        lines.append(f"Class margin: {margin:.3f}")
    if rejection_reason:
        lines.append(f"Rejection reason: {rejection_reason}")

    probabilities = analysis.get("probabilities") or {}
    if isinstance(probabilities, dict) and probabilities:
        lines.append("Class probabilities:")
        for label in ("Clean", "LightMoss", "MediumMoss", "HeavyMoss"):
            value = probabilities.get(label)
            if isinstance(value, (int, float)):
                lines.append(f"  • {label}: {value:.3f}")

    return "\n".join(lines)


def get_filtration_suggestion(analysis: Dict) -> str:
    """One-shot: build context from the analysis and ask Groq for a filtration recommendation."""
    client = _get_client()
    context = _build_water_context(analysis)

    response = _call_with_retry(
        client.chat.completions.create,
        model=_MODEL,
        messages=[
            {"role": "system", "content": FILTRATION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Here is the water quality analysis:\n\n{context}\n\nProvide your filtration recommendation."},
        ],
        temperature=0.4,
        max_tokens=512,
    )
    return response.choices[0].message.content or ""


def chat_message(
    analysis: Dict,
    history: List[Dict[str, str]],
    user_message: str,
) -> str:
    """Continue a multi-turn conversation grounded in the water analysis context."""
    client = _get_client()
    context = _build_water_context(analysis)

    messages: list[dict] = [
        {"role": "system", "content": FILTRATION_SYSTEM_PROMPT},
        # Inject the water context as the first user turn so every reply is grounded
        {"role": "user", "content": f"Water quality analysis context:\n\n{context}"},
        {"role": "assistant", "content": "Understood. I have the water quality context. How can I help?"},
    ]

    # Replay prior conversation
    for msg in history:
        role = "user" if msg.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": msg.get("text", "")})

    # Append the new user message
    messages.append({"role": "user", "content": user_message})

    response = _call_with_retry(
        client.chat.completions.create,
        model=_MODEL,
        messages=messages,
        temperature=0.5,
        max_tokens=512,
    )
    return response.choices[0].message.content or ""


def get_container_cleaning_suggestion(analysis: Dict) -> str:
    """One-shot: recommend container cleaning/discard action from scan result."""
    client = _get_client()
    context = _build_container_context(analysis)

    response = _call_with_retry(
        client.chat.completions.create,
        model=_MODEL,
        messages=[
            {"role": "system", "content": CONTAINER_CLEANING_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Here is the container scan analysis:\n\n"
                    f"{context}\n\n"
                    "Provide cleaning and keep/discard guidance."
                ),
            },
        ],
        temperature=0.4,
        max_tokens=420,
    )
    return response.choices[0].message.content or ""


def chat_container_message(
    analysis: Dict,
    history: List[Dict[str, str]],
    user_message: str,
) -> str:
    """Continue multi-turn chat grounded in container classification context."""
    client = _get_client()
    context = _build_container_context(analysis)

    messages: list[dict] = [
        {"role": "system", "content": CONTAINER_CLEANING_SYSTEM_PROMPT},
        {"role": "user", "content": f"Container analysis context:\n\n{context}"},
        {
            "role": "assistant",
            "content": "Understood. I have the container classification context. How can I help?",
        },
    ]

    for msg in history:
        role = "user" if msg.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": msg.get("text", "")})

    messages.append({"role": "user", "content": user_message})

    response = _call_with_retry(
        client.chat.completions.create,
        model=_MODEL,
        messages=messages,
        temperature=0.5,
        max_tokens=420,
    )
    return response.choices[0].message.content or ""
