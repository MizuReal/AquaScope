"""Route for container image analysis using the moss classification model."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.moss_classifier import classify

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

logger.info(
    "[container] Router module loaded — POST /analyze will be mounted at /container/analyze"
)


@router.post("/analyze")
async def analyze_container(file: UploadFile = File(...)):
    """Accept a container image and return moss classification results.

    Returns JSON:
        predicted_class : str
        confidence      : float  (0-1)
        probabilities   : dict   {class_name: float}
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    image_bytes = await file.read()
    if len(image_bytes) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB limit.")

    try:
        result = classify(image_bytes)
    except FileNotFoundError as exc:
        logger.error("Model not found: %s", exc)
        raise HTTPException(status_code=503, detail="Classification model not available.")
    except Exception as exc:
        logger.exception("Classification failed")
        raise HTTPException(status_code=500, detail=f"Classification error: {exc}")

    return result
