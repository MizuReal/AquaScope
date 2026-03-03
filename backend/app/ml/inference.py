from __future__ import annotations

import re
import logging
import os
from dataclasses import dataclass
from io import BytesIO
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps


_RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
_NUMERIC_PATTERN = re.compile(r"^-?(?:\d+\.?\d*|\d*\.\d+)$")
logger = logging.getLogger(__name__)

# Set up logging to show info level
logging.basicConfig(level=logging.INFO)

# Canonical dimensions matching the template exactly
_CANONICAL_WIDTH = 1080
_CANONICAL_HEIGHT = 1240

# Fiducial centers: 56px squares at 12px from edges -> center at 12 + 28 = 40px
_FIDUCIAL_TARGETS = np.array(
    [
        [40.0, 40.0],                                      # top-left
        [_CANONICAL_WIDTH - 40.0, 40.0],                   # top-right
        [_CANONICAL_WIDTH - 40.0, _CANONICAL_HEIGHT - 40.0],  # bottom-right
        [40.0, _CANONICAL_HEIGHT - 40.0],                  # bottom-left
    ],
    dtype=np.float32,
)

# Detection parameters
_FIDUCIAL_MIN_AREA_RATIO = 0.0004
_FIDUCIAL_MAX_AREA_RATIO = 0.025

# Debug flag - set to True to save intermediate images
DEBUG_SAVE_IMAGES = os.environ.get("OCR_DEBUG", "").lower() in ("1", "true", "yes")
DEBUG_OUTPUT_DIR = os.environ.get("OCR_DEBUG_DIR", "./ocr_debug")


# ============================================================================
# PRECISE WRITE-AREA COORDINATES - CAREFULLY CALCULATED FROM TEMPLATE
# ============================================================================
# After perspective transform, the image is exactly 1080x1240px
# The fiducials are at 12px from edges, so the "sheet" content starts at ~68px
# 
# Template structure (inside the 40px padding):
#   - header: padding-top 20px + h1 28px + meta-row ~52px = ~100px
#   - instructions: ~65px (with 16px margin-bottom)  
# ============================================================================
# WRITE-AREA COORDINATES - DETECTED FROM ACTUAL CAPTURES
# ============================================================================
# These coordinates were determined by analyzing actual captured images.
# The write areas are the white rectangular regions where numbers are written.
# 
# DETECTED POSITIONS (from contour analysis of warped image):
#   Row 0: y=306, height=97
#   Row 1: y=489, height=96  
#   Row 2: y=671, height=96
#   Row 3: y=853, height=97
#   Row 4: y=1034, height=97
#
#   Left column: x=60-61, width=445-446
#   Right column: x=573, width=446-448
#
# We add small margins inward to avoid capturing borders

_ROW_Y_POSITIONS = [306, 489, 671, 853, 1034]  # Detected y-coordinates for each row
_LEFT_COL_X = 65      # Left column starts at x=60, add 5px margin
_RIGHT_COL_X = 578    # Right column starts at x=573, add 5px margin
_WRITE_WIDTH = 435    # Detected ~445px, subtract margins
_WRITE_HEIGHT = 85    # Detected ~97px, subtract margins for safety


@dataclass(frozen=True)
class WriteAreaSpec:
    """Precise pixel coordinates of a write-area in the canonical 1080x1240 image."""
    name: str
    x: int      # Left edge (pixels)
    y: int      # Top edge (pixels)
    width: int  # Width (pixels)
    height: int # Height (pixels)


def _compute_write_areas() -> Tuple[WriteAreaSpec, ...]:
    """
    Compute exact pixel coordinates for all 9 write-areas.
    Layout: 5 rows x 2 columns (Row 4 has only left column — turbidity).
    Coordinates based on actual image analysis, not template CSS.
    """
    # Field names in order: left column then right column for each row
    # Updated to match new water quality parameters
    fields = [
        ("pH", 0, 0),                      # Row 0, Left
        ("hardness", 0, 1),                # Row 0, Right
        ("solids", 1, 0),                  # Row 1, Left
        ("chloramines", 1, 1),             # Row 1, Right
        ("sulfate", 2, 0),                 # Row 2, Left
        ("conductivity", 2, 1),            # Row 2, Right
        ("organic_carbon", 3, 0),          # Row 3, Left
        ("trihalomethanes", 3, 1),         # Row 3, Right
        ("turbidity", 4, 0),               # Row 4, Left
    ]
    
    areas = []
    for name, row, col in fields:
        x = _LEFT_COL_X if col == 0 else _RIGHT_COL_X
        y = _ROW_Y_POSITIONS[row] + 5  # Add small top margin
        
        areas.append(WriteAreaSpec(
            name=name,
            x=x,
            y=y,
            width=_WRITE_WIDTH,
            height=_WRITE_HEIGHT,
        ))
    
    return tuple(areas)


WRITE_AREAS = _compute_write_areas()


def _load_and_normalize(image_bytes: bytes, target_long_edge: int = 1600) -> Tuple[np.ndarray, bool]:
    """
    Load image and attempt perspective correction using fiducials.
    Returns (image, is_canonical) where is_canonical=True means fiducials were found
    and image is warped to exact 1080x1240.
    """
    if not image_bytes:
        raise ValueError("No image payload provided")
    try:
        with Image.open(BytesIO(image_bytes)) as pil_img:
            pil_img = ImageOps.exif_transpose(pil_img)
            pil_img = pil_img.convert("RGB")
            
            # Minimal preprocessing - don't over-process before detection
            width, height = pil_img.size
            long_edge = max(width, height)
            if long_edge == 0:
                raise ValueError("Invalid image dimensions")
            
            # Scale to reasonable size for processing
            scale = target_long_edge / long_edge
            if abs(scale - 1.0) > 0.05:
                pil_img = pil_img.resize((int(width * scale), int(height * scale)), _RESAMPLE)
            
            image = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    except Exception as exc:
        raise ValueError("Unable to decode image for OCR processing") from exc
    
    # Try fiducial-based warping first
    warped = _warp_with_fiducials(image)
    if warped is not None:
        logger.info("Fiducials detected - using perspective-corrected image")
        if DEBUG_SAVE_IMAGES:
            _save_debug_image(warped, "01_warped.png")
        return warped, True
    
    # Fallback: just deskew
    logger.warning("Fiducials NOT detected - using fallback deskew (accuracy will be reduced)")
    deskewed = _deskew(image)
    return deskewed, False


def _save_debug_image(image: np.ndarray, filename: str) -> None:
    """Save debug image if DEBUG_SAVE_IMAGES is enabled."""
    if not DEBUG_SAVE_IMAGES:
        return
    try:
        os.makedirs(DEBUG_OUTPUT_DIR, exist_ok=True)
        path = os.path.join(DEBUG_OUTPUT_DIR, filename)
        cv2.imwrite(path, image)
        logger.debug("Saved debug image: %s", path)
    except Exception as e:
        logger.warning("Failed to save debug image %s: %s", filename, e)


def _deskew(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(thresh)
    if coords is None:
        return image
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 1:
        return image
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width // 2, height // 2), angle, 1.0)
    return cv2.warpAffine(image, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _warp_with_fiducials(image: np.ndarray) -> Optional[np.ndarray]:
    fiducials = _detect_fiducials(image)
    if fiducials is None:
        logger.debug("Fiducial detection failed - could not find all 4 corners")
        return None

    # Correct sideways orientation before warping
    fiducials = _correct_fiducial_orientation(fiducials, image)

    ordered = np.array(
        [fiducials[label] for label in ("tl", "tr", "br", "bl")],
        dtype=np.float32,
    )
    logger.info("Fiducials detected at: tl=%s tr=%s br=%s bl=%s", 
                fiducials.get("tl"), fiducials.get("tr"), 
                fiducials.get("br"), fiducials.get("bl"))
    matrix = cv2.getPerspectiveTransform(ordered, _FIDUCIAL_TARGETS)
    return cv2.warpPerspective(
        image,
        matrix,
        (_CANONICAL_WIDTH, _CANONICAL_HEIGHT),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _correct_fiducial_orientation(
    corners: Dict[str, np.ndarray],
    image: np.ndarray,
) -> Dict[str, np.ndarray]:
    """
    Detect and correct sideways card orientation via aspect-ratio analysis.

    The card is 1080x1240 (portrait, ratio ~0.87). When the detected fiducial
    quadrilateral is landscape (wider than tall), the card was captured sideways.
    We try both 90-degree label rotations, cheaply warp each, and pick the one
    whose header region contains more dark pixels (text/borders), which indicates
    the correct upright orientation.
    """
    tl, tr, br, bl = corners["tl"], corners["tr"], corners["br"], corners["bl"]

    # Measure detected quad dimensions
    avg_width = (float(np.linalg.norm(tr - tl)) + float(np.linalg.norm(br - bl))) / 2.0
    avg_height = (float(np.linalg.norm(bl - tl)) + float(np.linalg.norm(br - tr))) / 2.0

    if avg_height < 1e-6:
        return corners

    aspect = avg_width / avg_height

    if aspect <= 1.0:
        logger.info("Fiducial quad is portrait (aspect=%.3f) — no rotation needed", aspect)
        return corners

    logger.warning(
        "Fiducial quad is LANDSCAPE (aspect=%.3f) — card is sideways, correcting orientation",
        aspect,
    )

    # Two possible 90° label reassignments:
    # rot_a: card was rotated CW on the table
    rot_a = {"tl": corners["tr"], "tr": corners["br"], "br": corners["bl"], "bl": corners["tl"]}
    # rot_b: card was rotated CCW on the table
    rot_b = {"tl": corners["bl"], "tr": corners["tl"], "br": corners["tr"], "bl": corners["br"]}

    score_a = _score_header_region(image, rot_a)
    score_b = _score_header_region(image, rot_b)

    logger.info("Orientation header scores: rot_a=%.0f  rot_b=%.0f", score_a, score_b)

    chosen, label = (rot_a, "CW") if score_a >= score_b else (rot_b, "CCW")
    logger.info("Applied %s correction for sideways card", label)
    return chosen


def _score_header_region(image: np.ndarray, corners: Dict[str, np.ndarray]) -> float:
    """
    Cheaply warp the image with the given corner mapping and return the count
    of dark pixels in the header band.  The correct orientation will have the
    title text ("Water Quality Data Sheet"), meta row, and instruction box in
    the top ~15% of the card, producing significantly more dark pixels than the
    mostly-blank bottom region that an incorrect rotation would place there.
    """
    ordered = np.array(
        [corners[lbl] for lbl in ("tl", "tr", "br", "bl")], dtype=np.float32
    )
    matrix = cv2.getPerspectiveTransform(ordered, _FIDUCIAL_TARGETS)
    warped = cv2.warpPerspective(
        image, matrix, (_CANONICAL_WIDTH, _CANONICAL_HEIGHT),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
    )
    # Sample the header strip (y 60-200, skip fiducial zone on sides)
    header = warped[60:200, 100:980]
    gray = cv2.cvtColor(header, cv2.COLOR_BGR2GRAY)
    return float(np.sum(gray < 100))


def _detect_fiducials(image: np.ndarray) -> Optional[Dict[str, np.ndarray]]:
    """
    Robust detection of solid BLACK square fiducial markers.
    
    Uses multiple thresholding strategies to handle varying lighting conditions.
    The markers are pure black 56x56px squares positioned in the corners.
    """
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    image_area = float(height * width)
    min_area = image_area * _FIDUCIAL_MIN_AREA_RATIO
    max_area = image_area * _FIDUCIAL_MAX_AREA_RATIO
    
    all_candidates: List[Tuple[str, float, float, float]] = []
    
    # Strategy 1: Fixed threshold for pure black
    _, thresh1 = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
    
    # Strategy 2: Otsu's method
    _, thresh2 = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    
    # Strategy 3: Adaptive threshold for uneven lighting
    thresh3 = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 51, 15
    )
    
    for thresh in [thresh1, thresh2, thresh3]:
        # Morphological cleanup
        kernel = np.ones((3, 3), np.uint8)
        cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)
        
        contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue
            
            x, y, w, h = cv2.boundingRect(contour)
            if h == 0:
                continue
            
            # Must be roughly square
            aspect = w / float(h)
            if aspect < 0.65 or aspect > 1.5:
                continue
            
            # Check solidity (must be filled)
            hull = cv2.convexHull(contour)
            hull_area = cv2.contourArea(hull)
            if hull_area == 0:
                continue
            solidity = area / hull_area
            if solidity < 0.75:
                continue
            
            # Verify the region is actually dark
            mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.drawContours(mask, [contour], -1, 255, -1)
            mean_intensity = cv2.mean(gray, mask=mask)[0]
            if mean_intensity > 120:
                continue
            
            cx = x + w / 2.0
            cy = y + h / 2.0
            label = _classify_corner(cx, cy, width, height)
            
            if label:
                score = solidity * (1.0 - abs(1.0 - aspect))
                all_candidates.append((label, cx, cy, score))
    
    # Remove duplicates and pick best for each corner
    corners: Dict[str, np.ndarray] = {}
    for label in ("tl", "tr", "br", "bl"):
        best = None
        for cand in all_candidates:
            if cand[0] == label:
                if best is None or cand[3] > best[3]:
                    best = cand
        if best:
            corners[label] = np.array([best[1], best[2]], dtype=np.float32)
    
    logger.debug("Fiducial detection found %d/4 corners: %s", len(corners), list(corners.keys()))
    return corners if len(corners) == 4 else None


def _classify_corner(cx: float, cy: float, width: int, height: int) -> Optional[str]:
    """Classify a detected marker as one of the four corners."""
    # Fiducials should be in the outer 35% of each dimension
    margin_ratio = 0.35
    
    if cx < width * margin_ratio:
        x_side = "l"
    elif cx > width * (1 - margin_ratio):
        x_side = "r"
    else:
        return None
    
    if cy < height * margin_ratio:
        y_side = "t"
    elif cy > height * (1 - margin_ratio):
        y_side = "b"
    else:
        return None
    
    return y_side + x_side


# ============================================================================
# NEW SIMPLIFIED PREPROCESSING - Less aggressive, preserves digit features
# ============================================================================

def _preprocess_for_ocr_simple(region: np.ndarray) -> np.ndarray:
    """
    Preprocessing for photographed forms — grayscale enhancement only.
    
    Key insight: EasyOCR's CRNN recognizer is a deep learning model trained on
    natural images. It uses grayscale gradient information to distinguish similar
    digits (e.g. 3 vs 2, 8 vs 6). Binarization destroys these gradients.
    
    Strategy: normalize contrast with CLAHE, light denoise, preserve grayscale.
    """
    if region.size == 0:
        return region
    
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    
    # Upscale 2x for better digit recognition
    h, w = gray.shape
    scaled = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    
    # CLAHE to normalize contrast across the region (handles uneven lighting)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    normalized = clahe.apply(scaled)
    
    # Light Gaussian blur to reduce camera noise without destroying features
    denoised = cv2.GaussianBlur(normalized, (3, 3), 0)
    
    # Add border padding (helps OCR engine with edge characters)
    padded = cv2.copyMakeBorder(denoised, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)
    
    return cv2.cvtColor(padded, cv2.COLOR_GRAY2BGR)


# ============================================================================
# EXTRACTOR CLASS - Uses precise pixel coordinates
# ============================================================================

class WaterQualityOCRExtractor:
    """
    Extracts numeric values from water quality data sheet.
    
    Key design decisions:
    1. Uses ABSOLUTE PIXEL coordinates (not ratios) for maximum precision
    2. Targets ONLY the write-areas (not labels) 
    3. Minimal preprocessing to preserve digit features (adaptive threshold only)
    4. Zero-margin crops to exclude form borders
    5. Robust decimal detection
    """
    
    def __init__(
        self,
        write_areas: Sequence[WriteAreaSpec],
        *,
        confidence_threshold: float = 0.15,  # Very low - we validate with regex
    ) -> None:
        self._areas = tuple(write_areas)
        self._threshold = confidence_threshold
        # Allow digits and decimal point/comma
        self._allowlist = "0123456789.,"
    
    def extract(self, image_bytes: bytes, reader: "easyocr.Reader") -> Dict[str, Optional[str]]:
        """Extract all field values from the image."""
        logger.info("=" * 60)
        logger.info("STARTING OCR EXTRACTION")
        logger.info("=" * 60)
        
        image, is_canonical = _load_and_normalize(image_bytes)
        
        logger.info(f"Image loaded: shape={image.shape}, is_canonical={is_canonical}")
        
        results: Dict[str, Optional[str]] = {area.name: None for area in self._areas}
        
        if not is_canonical:
            logger.error("FIDUCIALS NOT DETECTED - Cannot use fixed coordinates!")
            logger.error("The image will be processed with fallback which is very inaccurate")
            return self._fallback_full_ocr(image, reader)
        
        # Save the warped image for debugging
        if DEBUG_SAVE_IMAGES:
            _save_debug_image(image, "00_warped_canonical.png")
            # Also save with regions drawn
            debug_img = image.copy()
            for area in self._areas:
                cv2.rectangle(debug_img, (area.x, area.y), 
                             (area.x + area.width, area.y + area.height), 
                             (0, 255, 0), 2)
                cv2.putText(debug_img, area.name[:6], (area.x, area.y - 5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            _save_debug_image(debug_img, "00_regions_overlay.png")
        
        # Process each write area
        for idx, area in enumerate(self._areas):
            logger.info(f"\n--- Processing field: {area.name} ---")
            logger.info(f"    Region: x={area.x}, y={area.y}, w={area.width}, h={area.height}")
            
            region = self._crop_write_area(image, area)
            logger.info(f"    Cropped region shape: {region.shape}")
            
            if DEBUG_SAVE_IMAGES:
                _save_debug_image(region, f"region_{idx:02d}_{area.name}_raw.png")
            
            # Single-pass extraction using adaptive threshold preprocessing
            value = self._extract_from_region(region, reader, area.name)
            
            results[area.name] = value
            logger.info(f"    FINAL VALUE for {area.name}: {value}")
        
        logger.info("=" * 60)
        logger.info(f"EXTRACTION COMPLETE: {results}")
        logger.info("=" * 60)
        
        return results
    
    def _crop_write_area(self, image: np.ndarray, area: WriteAreaSpec) -> np.ndarray:
        """Crop write area with inward margin to exclude form borders."""
        h, w = image.shape[:2]
        
        # Inward margin: shrink crop by a few pixels to avoid capturing
        # the form's box borders which OCR misreads as digits (e.g. '1').
        inset = 4
        x1 = max(0, area.x + inset)
        y1 = max(0, area.y + inset)
        x2 = min(w, area.x + area.width - inset)
        y2 = min(h, area.y + area.height - inset)
        
        logger.debug(f"    Crop bounds: ({x1},{y1}) to ({x2},{y2})")
        
        return image[y1:y2, x1:x2]
    
    def _extract_from_region(
        self, 
        region: np.ndarray, 
        reader: "easyocr.Reader",
        field_name: str,
    ) -> Optional[str]:
        """Extract numeric value from a single region using adaptive threshold."""
        if region.size == 0:
            logger.warning(f"    Empty region for {field_name}")
            return None
        
        processed = _preprocess_for_ocr_simple(region)
        
        logger.info(f"    Preprocessed region shape: {processed.shape}")
        
        if DEBUG_SAVE_IMAGES:
            _save_debug_image(processed, f"region_{field_name}_processed.png")
        
        # Run EasyOCR with tuned parameters
        # Balanced settings: capture more text while filtering noise
        try:
            detections = reader.readtext(
                processed,
                allowlist=self._allowlist,
                detail=1,
                paragraph=False,
                min_size=4,           # Small enough to catch decimal points
                text_threshold=0.4,   # Balanced detection threshold
                low_text=0.3,         # More permissive for faint strokes
                link_threshold=0.4,   # Lower link threshold to keep decimals connected
                decoder='greedy',     # Faster, works well for numbers
                batch_size=1,
                contrast_ths=0.2,     # Lower contrast requirement
                adjust_contrast=0.6,  # Moderate contrast adjustment
                width_ths=0.8,        # Allow wider character spacing
                mag_ratio=1.5,        # Magnify text slightly for detection
            )
            
            logger.info(f"    EasyOCR detections: {len(detections)} items")
            for det in detections:
                bbox, text, conf = det
                logger.info(f"      -> text='{text}', conf={conf:.3f}")
                
        except Exception as e:
            logger.error(f"    OCR failed for {field_name}: {e}")
            return None
        
        if not detections:
            logger.info(f"    No detections for {field_name}")
            return None
        
        # Process all detections
        result = self._process_detections(detections)
        logger.info(f"    Processed result: {result}")
        return result
    
    def _process_detections(self, detections: List) -> Optional[str]:
        """
        Process OCR detections into a clean numeric value.
        
        Strategy:
        1. Filter by confidence threshold
        2. Sort by x-position (left to right)
        3. Combine spatially close detections
        4. Clean and validate the result
        """
        if not detections:
            return None
        
        # Minimum confidence - lowered slightly to catch decimal points
        # which sometimes have lower confidence
        MIN_CONF = 0.15
        
        # Filter to only confident detections
        confident_dets = [d for d in detections if d[2] >= MIN_CONF]
        
        logger.info(f"    Confident detections (conf >= {MIN_CONF}): {len(confident_dets)}/{len(detections)}")
        
        if not confident_dets:
            # NO confident detections - return None, don't use garbage
            logger.info(f"    No confident detections - returning None (not using low-conf garbage)")
            return None
        
        # Sort confident detections by x-position (left to right)
        sorted_dets = sorted(confident_dets, key=lambda d: d[0][0][0] if d[0] else 0)
        
        # Check if detections should be combined (spatially close = same number)
        # or if they're separate entities
        if len(sorted_dets) == 1:
            text = str(sorted_dets[0][1]).strip()
            cleaned = self._clean_numeric(text)
            logger.info(f"    Single detection: '{text}' -> '{cleaned}'")
            if cleaned and self._is_valid_number(cleaned):
                return cleaned
            return None
        
        # Multiple detections - collect spatially close fragments
        fragments = []
        last_x_end = None
        
        for det in sorted_dets:
            bbox, text, conf = det
            text = str(text).strip()
            if not text:
                continue
            x_start = bbox[0][0]  # Top-left x
            x_end = bbox[1][0]    # Top-right x
            
            if last_x_end is not None:
                gap = x_start - last_x_end
                if gap > 100:
                    logger.info(f"    Large gap ({gap}px) - ignoring subsequent detection")
                    break
            
            fragments.append(text)
            last_x_end = x_end
        
        if not fragments:
            return None
        
        # Key heuristic: when CRAFT splits a number into exactly 2 pure-digit
        # groups, the split point is almost always where a decimal point was.
        # Insert a '.' between them to reconstruct the original number.
        if len(fragments) == 2:
            f1, f2 = fragments
            both_pure_digits = (f1.isdigit() and f2.isdigit())
            if both_pure_digits:
                decimal_text = f1 + '.' + f2
                logger.info(f"    Decimal insertion: '{f1}' + '{f2}' -> '{decimal_text}'")
                cleaned = self._clean_numeric(decimal_text)
                if cleaned and self._is_valid_number(cleaned):
                    return cleaned
        
        # Fallback: plain concatenation
        combined_text = ''.join(fragments)
        logger.info(f"    Combined text: '{combined_text}'")
        cleaned = self._clean_numeric(combined_text)
        logger.info(f"    After cleaning: '{cleaned}'")
        
        if cleaned and self._is_valid_number(cleaned):
            return cleaned
        
        return None
    
    def _clean_numeric(self, text: str) -> str:
        """
        Clean OCR output to extract numeric value.
        
        CONSERVATIVE approach - only fix obvious OCR errors,
        don't aggressively convert letters to digits.
        """
        if not text:
            return ""
        
        # Very conservative corrections - only the most common OCR errors
        corrections = {
            'O': '0',   # Capital O -> 0
            'o': '0',   # Lowercase o -> 0 (when in numeric context)
            'l': '1',   # Lowercase L -> 1
            'I': '1',   # Capital I -> 1  
            '|': '1',   # Pipe -> 1
        }
        
        corrected = ''.join(corrections.get(c, c) for c in text)
        
        # Handle commas: distinguish thousands separator from decimal comma.
        # Thousands separator: comma followed by exactly 3 digits (e.g., "18,620")
        # Decimal comma: comma followed by 1-2 digits (e.g., "592,89")
        if re.search(r'\d,\d{3}(?!\d)', corrected):
            corrected = corrected.replace(',', '')   # strip thousands separators
        else:
            corrected = corrected.replace(',', '.')  # decimal comma → dot
        
        # Extract only digits and decimal points
        cleaned = ""
        has_decimal = False
        for char in corrected:
            if char.isdigit():
                cleaned += char
            elif char == '.' and not has_decimal:
                cleaned += '.'
                has_decimal = True
        
        # Clean up the result
        # Remove leading zeros except for "0.xxx" 
        if cleaned and len(cleaned) > 1:
            if cleaned.startswith('0') and len(cleaned) > 1 and cleaned[1] != '.':
                cleaned = cleaned.lstrip('0') or '0'
        
        # Remove trailing decimal with no digits after
        if cleaned.endswith('.'):
            cleaned = cleaned[:-1]
        
        # Handle leading decimal (add 0)
        if cleaned.startswith('.'):
            cleaned = '0' + cleaned
        
        return cleaned
    
    def _is_valid_number(self, text: str) -> bool:
        """Check if text is a valid numeric value."""
        if not text:
            return False
        try:
            val = float(text)
            # Reasonable range for water quality parameters
            return -50 <= val <= 50000
        except ValueError:
            return False
    
    def _fallback_full_ocr(
        self, 
        image: np.ndarray, 
        reader: "easyocr.Reader"
    ) -> Dict[str, Optional[str]]:
        """Fallback: try to extract any numbers from full image."""
        logger.warning("Using fallback full-image OCR - results will be poor!")
        results = {area.name: None for area in self._areas}
        
        # This is a last resort - accuracy will be low
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            detections = reader.readtext(
                gray,
                allowlist="0123456789.",
                detail=1,
                paragraph=False,
            )
            
            logger.info(f"Fallback found {len(detections)} detections")
            
            # Extract any valid numbers found
            numbers = []
            for det in detections:
                text = self._clean_numeric(str(det[1]))
                if text and self._is_valid_number(text):
                    numbers.append(text)
                    logger.info(f"  Fallback number: {text}")
            
            # Assign found numbers to fields (best effort)
            for i, area in enumerate(self._areas):
                if i < len(numbers):
                    results[area.name] = numbers[i]
        except Exception as e:
            logger.error("Fallback OCR failed: %s", e)
        
        return results


# Create the extractor instance with our precise write areas
EXTRACTOR = WaterQualityOCRExtractor(WRITE_AREAS)

