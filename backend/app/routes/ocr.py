from __future__ import annotations

import logging
import os
from datetime import datetime
from io import BytesIO
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps

from app.services.ocr import EasyOCRService, get_ocr_service

# Directory to save incoming captures for debugging
CAPTURE_SAVE_DIR = Path(__file__).parent.parent.parent / "debug_output" / "captures"
CAPTURE_SAVE_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/data-card")
async def parse_data_card(
    file: UploadFile = File(...),
    ocr_service: EasyOCRService = Depends(get_ocr_service),
) -> dict:
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported")

    payload = await file.read()
    logger.info(
        "OCR upload received: filename=%s content_type=%s size=%s bytes",
        file.filename,
        file.content_type,
        len(payload),
    )
    
    # Save capture for debugging (always save latest)
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = Path(file.filename).suffix if file.filename else ".png"
        capture_path = CAPTURE_SAVE_DIR / f"capture_{timestamp}{ext}"
        capture_path.write_bytes(payload)
        # Also save as "latest" for easy access
        latest_path = CAPTURE_SAVE_DIR / f"latest{ext}"
        latest_path.write_bytes(payload)
        logger.info("Saved capture to: %s", capture_path)
    except Exception as e:
        logger.warning("Failed to save capture for debugging: %s", e)
    
    try:
        parsed = ocr_service.read_fixed_form_values(payload)
    except ValueError as exc:
        logger.exception("OCR decoding failed")
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Fixed-form OCR parsed %d fields (keys=%s)",
        len(parsed),
        sorted(parsed.keys()),
    )
    return {"parsed": parsed}


@router.post("/debug-regions", response_class=Response)
async def debug_regions(file: UploadFile = File(...)) -> Response:
    """
    Debug endpoint: returns image with write-area regions drawn on it.
    Use this to verify that region coordinates are correct.
    
    GREEN boxes = write areas where OCR reads
    BLUE boxes = full param boxes for reference
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported")
    
    payload = await file.read()
    
    try:
        # Lazy import heavy modules only when this debug endpoint is called
        import cv2
        from app.ml.inference import (
            WRITE_AREAS, _load_and_normalize,
            _ROW_Y_POSITIONS, _LEFT_COL_X, _RIGHT_COL_X, _WRITE_WIDTH, _WRITE_HEIGHT,
        )

        # Load and warp the image
        image, is_canonical = _load_and_normalize(payload)
        
        logger.info(f"Debug: image shape={image.shape}, is_canonical={is_canonical}")
        
        # Draw the detected write area positions in GREEN
        for area in WRITE_AREAS:
            cv2.rectangle(
                image,
                (area.x, area.y),
                (area.x + area.width, area.y + area.height),
                (0, 255, 0),  # Green
                2
            )
            # Label
            cv2.putText(
                image,
                area.name[:10],
                (area.x + 5, area.y + 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 0, 255),  # Red text
                1
            )
        
        # Add canonical status text
        status = f"CANONICAL (fiducials detected)" if is_canonical else "NOT CANONICAL - coords will be WRONG!"
        color = (0, 255, 255) if is_canonical else (0, 0, 255)
        cv2.putText(image, status, (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        
        # Add coordinate info
        info = f"Write areas: {len(WRITE_AREAS)} regions defined"
        cv2.putText(image, info, (20, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # Convert to PNG
        _, buffer = cv2.imencode('.png', image)
        
        return Response(
            content=buffer.tobytes(),
            media_type="image/png"
        )
    except Exception as exc:
        logger.exception("Debug regions failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
