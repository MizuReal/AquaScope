"""Thin wrapper around the Groq SDK (Llama 3.3 70B) for water treatment chat."""

from __future__ import annotations

import logging
import os
import re
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

_MODEL = "llama-3.3-70b-versatile"
_MAX_RETRIES = 3
_INITIAL_BACKOFF = 5  # seconds

_WATER_TOPIC_KEYWORDS = {
    "water",
    "potable",
    "drink",
    "drinking",
    "safety",
    "safe",
    "unsafe",
    "sample",
    "risk",
    "microbial",
    "bacteria",
    "contamin",
    "filter",
    "filtration",
    "boil",
    "chlorine",
    "chloramines",
    "turbidity",
    "ph",
    "hardness",
    "sulfate",
    "conductivity",
    "trihalomethanes",
}

_DASHBOARD_TOPIC_KEYWORDS = {
    "dashboard",
    "data",
    "activity",
    "scan",
    "scans",
    "prediction",
    "predictions",
    "history",
    "trend",
    "metrics",
    "result",
}

_LIGHT_SOCIAL_TURNS = {
    "hi",
    "hello",
    "hey",
    "thanks",
    "thank you",
    "ok",
    "okay",
}

_OFFTOPIC_REPLY = (
    "I can only answer questions about water safety and your water-quality data. "
    "Please ask a water-safety related question."
)

FILTRATION_SYSTEM_PROMPT = (
    "You are a friendly and knowledgeable water-safety assistant. "
    "The user will provide water quality analysis results including microbial risk "
    "level, WHO threshold violations, detected bacteria, and parameter readings. "
    "Your job:\n"
    "1. Recommend the most appropriate WHO-recognised filtration or disinfection "
    "method(s) for the specific contaminants found.\n"
    "2. Briefly explain WHY each method works for those contaminants in plain language.\n"
    "3. Note any low-cost alternatives suitable for field or household use.\n"
    "4. If the water is already safe, say so clearly and reassuringly.\n"
    "Keep answers concise (200 words or less). Use short numbered steps or dashes for lists. "
    "Do NOT use markdown symbols such as *, **, #, or backticks. "
    "Write in plain, friendly, easy-to-understand language."
)

CONTAINER_CLEANING_SYSTEM_PROMPT = (
    "You are a friendly water-container hygiene advisor. "
    "The user provides a container scan result with one of these classes: "
    "Clean, LightMoss, MediumMoss, HeavyMoss, or an invalid/unrecognized result. "
    "Your job:\n"
    "1. Explain what the class means in simple, practical terms.\n"
    "2. Give clear step-by-step cleaning guidance tailored to that class.\n"
    "3. State when to keep using, deep-clean, or discard/replace the container.\n"
    "4. Include low-cost household options and a brief safety reminder.\n"
    "Keep responses concise (180 words or less) and easy to follow. "
    "Do NOT use markdown symbols such as *, **, #, or backticks. "
    "Use plain numbered steps or dashes for lists instead."
)

DASHBOARD_SYSTEM_PROMPT = (
    "You are a friendly personal water-safety assistant built into a water quality dashboard. "
    "You have access to the user's dashboard activity data — their total scan count, "
    "prediction count, and their most recent water sample result. "
    "Your job:\n"
    "1. Summarize what the user's activity data tells you in plain, conversational language.\n"
    "2. Highlight anything noteworthy about their latest sample (risk level, potability).\n"
    "3. Suggest clear, practical next steps based on their data.\n"
    "4. If data is limited, be honest and encouraging rather than making things up.\n"
    "Keep answers concise (200 words or less). "
    "Do NOT use markdown symbols such as *, **, #, or backticks. "
    "Write in a warm, easy-to-understand tone as if talking to a non-expert."
)

COMPARE_SAMPLES_SYSTEM_PROMPT = (
    "You are a helpful water-quality comparison assistant. "
    "The user provides readings from two water samples taken at different times or locations. "
    "Your job:\n"
    "1. Compare the two samples and highlight the most important differences.\n"
    "2. For each parameter that changed significantly, explain whether the change is an improvement or a concern.\n"
    "3. Summarize the overall trend in 1-2 sentences (is the water getting better, worse, or staying the same?).\n"
    "4. Suggest one practical next step.\n"
    "Keep the response concise (180 words or less). "
    "Do NOT use markdown symbols such as *, **, #, or backticks. "
    "Use plain numbered steps or dashes for lists instead."
)


_client_instance: Optional[Groq] = None


def _get_client() -> Groq:
    global _client_instance
    if _client_instance is not None:
        return _client_instance
    api_key = os.getenv("GROQ_API_KEY", "")
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


def _is_query_relevant(user_message: str, focus: str) -> bool:
    text = (user_message or "").strip().lower()
    if not text:
        return True

    if text in _LIGHT_SOCIAL_TURNS:
        return True

    if len(text.split()) <= 2 and any(greet == text for greet in _LIGHT_SOCIAL_TURNS):
        return True

    tokens = [t for t in re.split(r"[^a-z0-9]+", text) if t]
    if not tokens:
        return False

    keyword_pool = set(_WATER_TOPIC_KEYWORDS)
    if focus == "my_data":
        keyword_pool.update(_DASHBOARD_TOPIC_KEYWORDS)

    for token in tokens:
        if token in keyword_pool:
            return True
        if any(token.startswith(stem) for stem in ("contamin", "filter", "predict")):
            return True

    return any(keyword in text for keyword in keyword_pool if len(keyword) >= 6)


def _build_offtopic_reply(analysis: Dict, focus: str) -> str:
    return _OFFTOPIC_REPLY


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
                lines.append(f"  - {label}: {value:.3f}")

    return "\n".join(lines)


def _build_dashboard_context(analysis: Dict) -> str:
    """Build grounding context for the 'my_data' dashboard chat tab.

    The frontend sends:
      { source, user_stats: {scans, predictions}, context: { focus, user_name,
        dashboard_metrics: {scans, predictions}, last_sample: {risk_level,
        is_potable, recorded_at} } }
    """
    lines: list[str] = []

    ctx = analysis.get("context") or {}
    user_name = ctx.get("user_name") or "the user"
    lines.append(f"User: {user_name}")

    metrics = ctx.get("dashboard_metrics") or analysis.get("user_stats") or {}
    scans = metrics.get("scans", 0)
    predictions = metrics.get("predictions", 0)
    lines.append(f"Total scans recorded: {scans}")
    lines.append(f"Total potability predictions made: {predictions}")

    last = ctx.get("last_sample")
    if last:
        risk = last.get("risk_level") or "unknown"
        potable = last.get("is_potable")
        recorded_at = last.get("recorded_at") or ""
        potable_str = "potable (safe to drink)" if potable else "not potable (unsafe)"
        lines.append(f"Most recent sample result: {potable_str}, risk level: {risk}")
        if recorded_at:
            lines.append(f"Recorded at: {recorded_at}")
    else:
        lines.append("Most recent sample: no data available yet.")

    return "\n".join(lines)


def _build_dashboard_water_context(analysis: Dict) -> str:
    """Build grounding context for the 'water_quality' dashboard chat tab.

    The frontend sends last_sample with: label, ph, turbidity, hardness,
    chloramines, risk_level, is_potable, confidence, recorded_at.
    """
    lines: list[str] = []

    ctx = analysis.get("context") or {}
    last = ctx.get("last_sample")

    if last:
        label = last.get("label") or "last sample"
        lines.append(f"Sample: {label}")

        potable = last.get("is_potable")
        risk = last.get("risk_level") or "unknown"
        confidence = last.get("confidence")
        potable_str = "potable (safe to drink)" if potable else "not potable (unsafe)"
        lines.append(f"Potability prediction: {potable_str}")
        lines.append(f"Risk level: {risk}")
        if isinstance(confidence, (int, float)):
            lines.append(f"Model confidence: {confidence * 100:.1f}%")

        params = [
            ("pH",          last.get("ph"),          "(safe range 6.5-8.5)"),
            ("Turbidity",   last.get("turbidity"),   "NTU (safe < 5)"),
            ("Hardness",    last.get("hardness"),    "mg/L"),
            ("Chloramines", last.get("chloramines"), "ppm"),
        ]
        readings = [(n, v, u) for n, v, u in params if isinstance(v, (int, float))]
        if readings:
            lines.append("Measured parameters:")
            for name, value, unit in readings:
                lines.append(f"  - {name}: {value:.2f} {unit}".rstrip())

        recorded_at = last.get("recorded_at") or ""
        if recorded_at:
            lines.append(f"Recorded at: {recorded_at}")
    else:
        lines.append("No recent water sample data available.")

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
    """Continue a multi-turn conversation grounded in the correct context.

    Routes to a dedicated context builder and system prompt based on the
    'focus' field sent by the dashboard frontend:
      - 'my_data'       -> DASHBOARD_SYSTEM_PROMPT + _build_dashboard_context
      - 'water_quality' -> FILTRATION_SYSTEM_PROMPT + _build_dashboard_water_context
      - (anything else) -> FILTRATION_SYSTEM_PROMPT + _build_water_context (field analysis)
    """
    client = _get_client()

    focus = (analysis.get("context") or {}).get("focus") or ""

    if not _is_query_relevant(user_message, focus):
        return _build_offtopic_reply(analysis, focus)

    if focus == "my_data":
        system_prompt = DASHBOARD_SYSTEM_PROMPT
        context = _build_dashboard_context(analysis)
        handshake = "Got it! I can see your dashboard activity. How can I help you today?"
    elif focus == "water_quality" and analysis.get("source") in ("web-dashboard", "web-widget", "mobile-app"):
        system_prompt = FILTRATION_SYSTEM_PROMPT
        context = _build_dashboard_water_context(analysis)
        handshake = "Got it! I have your latest water sample data. How can I help?"
    else:
        system_prompt = FILTRATION_SYSTEM_PROMPT
        context = _build_water_context(analysis)
        handshake = "Understood. I have the water quality context. How can I help?"

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"User data context:\n\n{context}"},
        {"role": "assistant", "content": handshake},
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


# ── Sample comparison ────────────────────────────────────────────────

_COMPARE_PARAMS = [
    ("ph", "pH", ""),
    ("hardness", "Hardness", "mg/L"),
    ("solids", "Total Dissolved Solids", "mg/L"),
    ("chloramines", "Chloramines", "ppm"),
    ("sulfate", "Sulfate", "mg/L"),
    ("conductivity", "Conductivity", "µS/cm"),
    ("organic_carbon", "Organic Carbon", "mg/L"),
    ("trihalomethanes", "Trihalomethanes", "µg/L"),
    ("turbidity", "Turbidity", "NTU"),
]


def _build_compare_context(sample_a: Dict, sample_b: Dict) -> str:
    """Build a plain-text comparison block from two sample dicts."""
    lines: list[str] = []

    label_a = sample_a.get("sample_label") or sample_a.get("source") or "Sample A"
    label_b = sample_b.get("sample_label") or sample_b.get("source") or "Sample B"
    date_a = sample_a.get("created_at") or ""
    date_b = sample_b.get("created_at") or ""

    lines.append(f"Sample A: {label_a} ({date_a})")
    risk_a = sample_a.get("risk_level") or "unknown"
    potable_a = sample_a.get("prediction_is_potable")
    lines.append(f"  Potable: {'yes' if potable_a else 'no'}, Risk: {risk_a}")

    lines.append(f"Sample B: {label_b} ({date_b})")
    risk_b = sample_b.get("risk_level") or "unknown"
    potable_b = sample_b.get("prediction_is_potable")
    lines.append(f"  Potable: {'yes' if potable_b else 'no'}, Risk: {risk_b}")

    lines.append("")
    lines.append("Parameter comparison:")
    for key, label, unit in _COMPARE_PARAMS:
        val_a = sample_a.get(key)
        val_b = sample_b.get(key)
        str_a = f"{val_a:.2f}" if isinstance(val_a, (int, float)) else "N/A"
        str_b = f"{val_b:.2f}" if isinstance(val_b, (int, float)) else "N/A"
        delta = ""
        if isinstance(val_a, (int, float)) and isinstance(val_b, (int, float)):
            diff = val_b - val_a
            delta = f" (change: {diff:+.2f})"
        lines.append(f"  {label}: {str_a} -> {str_b} {unit}{delta}")

    return "\n".join(lines)


def get_compare_summary(sample_a: Dict, sample_b: Dict) -> str:
    """One-shot AI comparison of two water samples."""
    client = _get_client()
    context = _build_compare_context(sample_a, sample_b)

    response = _call_with_retry(
        client.chat.completions.create,
        model=_MODEL,
        messages=[
            {"role": "system", "content": COMPARE_SAMPLES_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Here are two water samples to compare:\n\n{context}\n\n"
                    "Please compare them and highlight key changes."
                ),
            },
        ],
        temperature=0.4,
        max_tokens=512,
    )
    return response.choices[0].message.content or ""
