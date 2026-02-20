import logging
import sys
import types
from functools import lru_cache
from io import BytesIO
from typing import Dict, Iterable, List, Optional, Sequence

import cv2

# ── python-bidi compatibility shim ──────────────────────────────
# EasyOCR internally does `from bidi.algorithm import get_display`.
# python-bidi >=0.6 moved get_display to `bidi` and removed
# `bidi.algorithm`, so we patch it here before EasyOCR is imported.
try:
    from bidi.algorithm import get_display  # python-bidi <0.6
except (ImportError, ModuleNotFoundError):
    try:
        from bidi import get_display  # python-bidi >=0.6
        # Create a fake bidi.algorithm module so EasyOCR's import succeeds
        _fake_mod = types.ModuleType("bidi.algorithm")
        _fake_mod.get_display = get_display  # type: ignore[attr-defined]
        sys.modules["bidi.algorithm"] = _fake_mod
    except (ImportError, ModuleNotFoundError):
        # bidi not installed at all – provide a no-op so OCR still works
        _fake_mod = types.ModuleType("bidi.algorithm")
        _fake_mod.get_display = lambda text, *a, **kw: text  # type: ignore[attr-defined]
        sys.modules["bidi.algorithm"] = _fake_mod
# ────────────────────────────────────────────────────────────────

import easyocr
import numpy as np
from PIL import Image, ImageFilter, ImageOps

from app.ml.inference import EXTRACTOR


logger = logging.getLogger(__name__)


Detection = dict

_RESAMPLING_FILTER = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


class EasyOCRService:
    """Thin wrapper around EasyOCR so it can be dependency-injected."""

    def __init__(self, languages: Optional[Sequence[str]] = None, gpu: bool = False) -> None:
        self._reader = easyocr.Reader(list(languages or ("en",)), gpu=gpu)

    def read_text(self, image_bytes: bytes) -> List[Detection]:
        image = _bytes_to_image(image_bytes)
        preprocessed = _preprocess_image(image)
        easyocr_results = self._reader.readtext(preprocessed)
        detections = [
            {
                "bbox": [[float(coord) for coord in point] for point in bbox],
                "text": text,
                "confidence": float(confidence),
            }
            for bbox, text, confidence in easyocr_results
        ]
        return detections

    def read_fixed_form_values(self, image_bytes: bytes) -> Dict[str, Optional[str]]:
        logger.info("Fixed-form OCR extractor invoked")
        return EXTRACTOR.extract(image_bytes, self._reader)


def _bytes_to_image(image_bytes: bytes) -> np.ndarray:
    try:
        with Image.open(BytesIO(image_bytes)) as pil_img:
            pil_img = ImageOps.exif_transpose(pil_img)
            pil_img = pil_img.convert("RGB")
            pil_img = ImageOps.autocontrast(pil_img, cutoff=2)
            pil_img = pil_img.filter(ImageFilter.MedianFilter(size=3))
            max_edge = 2200
            if max(pil_img.size) > max_edge:
                pil_img.thumbnail((max_edge, max_edge), _RESAMPLING_FILTER)
            image = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    except Exception as exc:  # pragma: no cover - defensive guard
        raise ValueError("Unable to decode image for OCR processing") from exc
    return image


def _deskew_image(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(thresh)
    if coords is None:
        return image
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 1:
        return image
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def _preprocess_image(image: np.ndarray) -> np.ndarray:
    aligned = _deskew_image(image)
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    equalized = clahe.apply(gray)
    denoised = cv2.bilateralFilter(equalized, d=5, sigmaColor=60, sigmaSpace=60)
    thresh = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35,
        5,
    )
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    processed = cv2.cvtColor(closed, cv2.COLOR_GRAY2BGR)
    target_width = 1400
    height, width = processed.shape[:2]
    if width < target_width:
        scale = target_width / width
        processed = cv2.resize(processed, (target_width, int(height * scale)), interpolation=cv2.INTER_CUBIC)
    return processed


@lru_cache(maxsize=1)
def get_ocr_service(languages: Optional[Iterable[str]] = None, gpu: bool = False) -> EasyOCRService:
    # Languages/gpu parameters only matter on first call because of lru_cache.
    return EasyOCRService(languages=languages or ("en",), gpu=gpu)
