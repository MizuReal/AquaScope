"""Chat / filtration-suggestion endpoints powered by Groq (Llama 3.3 70B)."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.groq_llm import (
    chat_container_message,
    chat_message,
    get_compare_summary,
    get_container_cleaning_suggestion,
    get_filtration_suggestion,
)

try:
    from groq import RateLimitError as GroqRateLimitError
except ImportError:
    GroqRateLimitError = None  # type: ignore

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response models ────────────────────────────────────────

class FiltrationRequest(BaseModel):
    """The full (or partial) water analysis result object from the frontend."""
    analysis: Dict


class FiltrationResponse(BaseModel):
    suggestion: str


class ChatMessageItem(BaseModel):
    role: str  # "user" | "assistant"
    text: str


class ChatRequest(BaseModel):
    analysis: Dict
    history: List[ChatMessageItem] = Field(default_factory=list)
    message: str


class ChatResponse(BaseModel):
    reply: str


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/filtration-suggestion", response_model=FiltrationResponse)
def filtration_suggestion(body: FiltrationRequest) -> FiltrationResponse:
    """One-shot filtration recommendation grounded in the water analysis."""
    logger.info("=== /filtration-suggestion hit ===")
    logger.info("  analysis keys: %s", list(body.analysis.keys()))
    try:
        text = get_filtration_suggestion(body.analysis)
        logger.info("  suggestion length: %d chars", len(text))
    except Exception as exc:
        logger.exception("Groq filtration suggestion failed")
        code = 502
        detail = str(exc)
        if GroqRateLimitError and isinstance(exc, GroqRateLimitError):
            code = 429
            detail = "AI rate limit reached. Please wait a moment and try again."
        raise HTTPException(status_code=code, detail=detail) from exc
    return FiltrationResponse(suggestion=text)


@router.post("/message", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    """Multi-turn chat grounded in the water analysis context."""
    logger.info("=== /message hit ===")
    logger.info("  message: %.80s  history_len: %d", body.message, len(body.history))
    try:
        history = [{"role": m.role, "text": m.text} for m in body.history]
        reply = chat_message(body.analysis, history, body.message)
        logger.info("  reply length: %d chars", len(reply))
    except Exception as exc:
        logger.exception("Groq chat failed")
        code = 502
        detail = str(exc)
        if GroqRateLimitError and isinstance(exc, GroqRateLimitError):
            code = 429
            detail = "AI rate limit reached. Please wait a moment and try again."
        raise HTTPException(status_code=code, detail=detail) from exc
    return ChatResponse(reply=reply)


@router.post("/container-suggestion", response_model=FiltrationResponse)
def container_suggestion(body: FiltrationRequest) -> FiltrationResponse:
    """One-shot cleaning recommendation grounded in container scan analysis."""
    logger.info("=== /container-suggestion hit ===")
    logger.info("  analysis keys: %s", list(body.analysis.keys()))
    try:
        text = get_container_cleaning_suggestion(body.analysis)
        logger.info("  suggestion length: %d chars", len(text))
    except Exception as exc:
        logger.exception("Groq container suggestion failed")
        code = 502
        detail = str(exc)
        if GroqRateLimitError and isinstance(exc, GroqRateLimitError):
            code = 429
            detail = "AI rate limit reached. Please wait a moment and try again."
        raise HTTPException(status_code=code, detail=detail) from exc
    return FiltrationResponse(suggestion=text)


@router.post("/container-message", response_model=ChatResponse)
def chat_container(body: ChatRequest) -> ChatResponse:
    """Multi-turn chat grounded in container scan analysis context."""
    logger.info("=== /container-message hit ===")
    logger.info("  message: %.80s  history_len: %d", body.message, len(body.history))
    try:
        history = [{"role": m.role, "text": m.text} for m in body.history]
        reply = chat_container_message(body.analysis, history, body.message)
        logger.info("  reply length: %d chars", len(reply))
    except Exception as exc:
        logger.exception("Groq container chat failed")
        code = 502
        detail = str(exc)
        if GroqRateLimitError and isinstance(exc, GroqRateLimitError):
            code = 429
            detail = "AI rate limit reached. Please wait a moment and try again."
        raise HTTPException(status_code=code, detail=detail) from exc
    return ChatResponse(reply=reply)


# ── Compare samples ──────────────────────────────────────────────────

class CompareRequest(BaseModel):
    sample_a: Dict
    sample_b: Dict


class CompareResponse(BaseModel):
    summary: str


@router.post("/compare-samples", response_model=CompareResponse)
def compare_samples(body: CompareRequest) -> CompareResponse:
    """One-shot AI comparison of two water samples."""
    logger.info("=== /compare-samples hit ===")
    try:
        text = get_compare_summary(body.sample_a, body.sample_b)
        logger.info("  compare summary length: %d chars", len(text))
    except Exception as exc:
        logger.exception("Groq compare-samples failed")
        code = 502
        detail = str(exc)
        if GroqRateLimitError and isinstance(exc, GroqRateLimitError):
            code = 429
            detail = "AI rate limit reached. Please wait a moment and try again."
        raise HTTPException(status_code=code, detail=detail) from exc
    return CompareResponse(summary=text)