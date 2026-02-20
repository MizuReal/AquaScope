"""
Robust fiducial marker detection for real-time camera guidance.

Strategy: Detect 4 solid BLACK squares in the corners of the image.
Simple, high-contrast, reliable detection.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, ImageOps
from io import BytesIO

router = APIRouter()
logger = logging.getLogger(__name__)

# Lazy-load cv2 to speed up app startup
_cv2 = None
def _get_cv2():
    global _cv2
    if _cv2 is None:
        import cv2
        _cv2 = cv2
    return _cv2


def _detect_black_squares(image: np.ndarray) -> List[Tuple[float, float, float, float]]:
    """
    Detect solid black square markers using multiple strategies.
    Returns list of (center_x, center_y, width, height) for each detected square.
    """
    cv2 = _get_cv2()
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    detected = []
    
    # Strategy 1: Fixed threshold for pure black (printed)
    _, thresh1 = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    
    # Strategy 2: Higher threshold for screens (not pure black)
    _, thresh2 = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY_INV)
    
    # Strategy 3: Even higher for bright screens
    _, thresh3 = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY_INV)
    
    # Strategy 4: Otsu's method (adaptive to overall lighting)
    _, thresh4 = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    
    # Strategy 5: Adaptive threshold Gaussian
    thresh5 = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 51, 15
    )
    
    # Strategy 6: Adaptive threshold Mean
    thresh6 = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV, 31, 12
    )
    
    for thresh in [thresh1, thresh2, thresh3, thresh4, thresh5, thresh6]:
        # Morphological cleanup
        kernel = np.ones((3, 3), np.uint8)
        cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)
        
        contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        image_area = height * width
        
        for contour in contours:
            area = cv2.contourArea(contour)
            
            # Fiducials: 0.02% to 5% of image area (wider range)
            if area < image_area * 0.0002 or area > image_area * 0.05:
                continue
            
            x, y, w, h = cv2.boundingRect(contour)
            if h == 0 or w == 0:
                continue
            
            # Must be roughly square (aspect 0.4 to 2.5 - very forgiving)
            aspect = w / h
            if aspect < 0.4 or aspect > 2.5:
                continue
            
            # Check solidity (must be mostly filled)
            hull = cv2.convexHull(contour)
            hull_area = cv2.contourArea(hull)
            if hull_area == 0:
                continue
            solidity = area / hull_area
            if solidity < 0.6:  # More forgiving
                continue
            
            # Verify it's darker than average (relative check)
            mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.drawContours(mask, [contour], -1, 255, -1)
            mean_val = cv2.mean(gray, mask=mask)[0]
            # Compare to image mean - should be darker than average
            img_mean = np.mean(gray)
            if mean_val > min(160, img_mean * 0.85):  # Relative darkness check
                continue
            
            cx = x + w / 2.0
            cy = y + h / 2.0
            detected.append((cx, cy, float(w), float(h)))
    
    # Remove duplicates (same marker found by multiple strategies)
    unique = []
    for det in detected:
        is_dup = False
        for exist in unique:
            dist = ((det[0] - exist[0])**2 + (det[1] - exist[1])**2)**0.5
            if dist < max(det[2], exist[2]) * 0.8:
                is_dup = True
                break
        if not is_dup:
            unique.append(det)
    
    return unique


def _classify_corners(
    detections: List[Tuple[float, float, float, float]],
    width: int,
    height: int
) -> Dict[str, Dict]:
    """Classify detected squares into corner positions (tl, tr, bl, br)."""
    corners: Dict[str, Dict] = {}
    margin = 0.42  # Must be in outer 42% of image (more forgiving)
    
    logger.debug("Classifying %d detections in %dx%d image, margin=%.2f", len(detections), width, height, margin)
    
    for cx, cy, w, h in detections:
        nx, ny = cx / width, cy / height
        
        label = None
        if nx < margin and ny < margin:
            label = "tl"
        elif nx > (1 - margin) and ny < margin:
            label = "tr"
        elif nx < margin and ny > (1 - margin):
            label = "bl"
        elif nx > (1 - margin) and ny > (1 - margin):
            label = "br"
        else:
            logger.debug("  Rejected: (%.2f, %.2f) - not in corner region", nx, ny)
        
        if label and label not in corners:
            corners[label] = {"cx": cx, "cy": cy, "x": nx, "y": ny, "size": int((w + h) / 2)}
            logger.debug("  Assigned %s: (%.2f, %.2f)", label, nx, ny)
        elif label:
            logger.debug("  %s already assigned, skipping (%.2f, %.2f)", label, nx, ny)
    
    return corners


def _compute_quality(corners: Dict[str, Dict]) -> float:
    """Compute alignment quality from 0-1."""
    n = len(corners)
    if n == 0:
        return 0.0
    if n < 4:
        return n * 0.15  # Partial credit
    
    # All 4 corners found - check geometry
    tl = (corners["tl"]["x"], corners["tl"]["y"])
    tr = (corners["tr"]["x"], corners["tr"]["y"])
    bl = (corners["bl"]["x"], corners["bl"]["y"])
    br = (corners["br"]["x"], corners["br"]["y"])
    
    # Check aspect ratio (should be ~0.87 for 1080x1240)
    top_w = abs(tr[0] - tl[0])
    bot_w = abs(br[0] - bl[0])
    left_h = abs(bl[1] - tl[1])
    right_h = abs(br[1] - tr[1])
    
    avg_w = (top_w + bot_w) / 2
    avg_h = (left_h + right_h) / 2
    
    if avg_h < 0.05:
        return 0.5
    
    aspect = avg_w / avg_h
    expected = 1080 / 1240
    aspect_score = max(0, 1 - abs(aspect - expected) * 3)
    
    # Check parallelism
    w_diff = abs(top_w - bot_w) / max(top_w, bot_w, 0.01)
    h_diff = abs(left_h - right_h) / max(left_h, right_h, 0.01)
    parallel_score = max(0, 1 - (w_diff + h_diff))
    
    return 0.6 + (aspect_score * 0.2 + parallel_score * 0.2)


@router.post("/validate")
async def validate_fiducials(file: UploadFile = File(...)) -> dict:
    """
    Validate corner markers for camera auto-capture.
    
    Returns:
        detected: 0-4 corners found
        corners: position data for each corner
        quality: alignment quality 0-1
        ready: True when all 4 corners detected with good alignment
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only images supported")
    
    payload = await file.read()
    
    try:
        cv2 = _get_cv2()
        with Image.open(BytesIO(payload)) as pil_img:
            pil_img = ImageOps.exif_transpose(pil_img)
            pil_img = pil_img.convert("RGB")
            
            # Resize for speed (640px is plenty for corner detection)
            max_dim = 640
            if max(pil_img.size) > max_dim:
                ratio = max_dim / max(pil_img.size)
                new_size = (int(pil_img.width * ratio), int(pil_img.height * ratio))
                pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)
            
            image = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    except Exception as exc:
        logger.exception("Image decode failed")
        raise HTTPException(status_code=400, detail="Cannot decode image") from exc
    
    h, w = image.shape[:2]
    detections = _detect_black_squares(image)
    corners = _classify_corners(detections, w, h)
    quality = _compute_quality(corners)
    
    detected = len(corners)
    ready = detected == 4 and quality >= 0.6
    
    # More verbose logging for debugging
    logger.info("Fiducial: dims=%dx%d detected=%d quality=%.2f ready=%s detections_raw=%d", 
                w, h, detected, quality, ready, len(detections))
    for pos, data in corners.items():
        logger.info("  Corner %s: center=(%.1f, %.1f) size=%d", pos, data['cx'], data['cy'], data['size'])
    
    return {
        "detected": detected,
        "corners": corners,
        "quality": round(quality, 3),
        "ready": ready,
    }
