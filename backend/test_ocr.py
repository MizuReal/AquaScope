import sys
import types

# python-bidi compatibility shim for EasyOCR
try:
    from bidi.algorithm import get_display
except (ImportError, ModuleNotFoundError):
    try:
        from bidi import get_display
        _fake = types.ModuleType("bidi.algorithm")
        _fake.get_display = get_display
        sys.modules["bidi.algorithm"] = _fake
    except (ImportError, ModuleNotFoundError):
        _fake = types.ModuleType("bidi.algorithm")
        _fake.get_display = lambda text, *a, **kw: text
        sys.modules["bidi.algorithm"] = _fake

import cv2
import numpy as np
import easyocr

region = cv2.imread('debug_output/region_00_pH_raw.png')
gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
h, w = gray.shape
scaled = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
normalized = clahe.apply(scaled)
blurred = cv2.GaussianBlur(normalized, (5, 5), 0)

# Create reader
reader = easyocr.Reader(['en'], gpu=False, verbose=False)

# Test C=35
binary = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 35)
kernel = np.ones((2, 2), np.uint8)
cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
padded = cv2.copyMakeBorder(cleaned, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)
rgb = cv2.cvtColor(padded, cv2.COLOR_GRAY2BGR)

cv2.imwrite('debug_output/test_pH_final.png', padded)

print('Testing OCR on preprocessed pH region (C=35):')
results = reader.readtext(rgb, allowlist='0123456789.,', detail=1, paragraph=False, min_size=10, text_threshold=0.5, low_text=0.4)
for r in results:
    print(f'  text="{r[1]}" conf={r[2]:.3f}')

if not results:
    print("  No detections with high thresholds, trying lower...")
    results = reader.readtext(rgb, allowlist='0123456789.,', detail=1, paragraph=False, min_size=5, text_threshold=0.3, low_text=0.2)
    for r in results:
        print(f'  text="{r[1]}" conf={r[2]:.3f}')
