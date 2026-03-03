"""
OCR Pipeline Debug Script
=========================
This script processes a test image through the full OCR pipeline and saves
debug images at each stage to help diagnose coordinate alignment issues.

Output images saved to: backend/debug_output/
"""

import os
import sys
import cv2
import numpy as np
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageOps

# Add the app directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.ml.inference import (
    WRITE_AREAS,
    _CANONICAL_WIDTH,
    _CANONICAL_HEIGHT,
    _FIDUCIAL_TARGETS,
    _ROW_Y_POSITIONS,
    _LEFT_COL_X,
    _RIGHT_COL_X,
    _WRITE_WIDTH,
    _WRITE_HEIGHT,
    _detect_fiducials,
    _warp_with_fiducials,
    _preprocess_for_ocr_simple,
    _deskew,
)

# Output directory
DEBUG_OUTPUT = Path(__file__).parent / "debug_output"
DEBUG_OUTPUT.mkdir(exist_ok=True)

# Colors (BGR)
GREEN = (0, 255, 0)
RED = (0, 0, 255)
BLUE = (255, 0, 0)
YELLOW = (0, 255, 255)
CYAN = (255, 255, 0)
MAGENTA = (255, 0, 255)
WHITE = (255, 255, 255)
ORANGE = (0, 165, 255)


def save_image(image: np.ndarray, filename: str) -> str:
    """Save image and return path."""
    path = DEBUG_OUTPUT / filename
    cv2.imwrite(str(path), image)
    print(f"  ✓ Saved: {path}")
    return str(path)


def draw_text_with_bg(img, text, pos, font_scale=0.5, color=WHITE, bg_color=(0, 0, 0)):
    """Draw text with background for readability."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    thickness = 1
    (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
    x, y = pos
    cv2.rectangle(img, (x - 2, y - th - 4), (x + tw + 2, y + 4), bg_color, -1)
    cv2.putText(img, text, (x, y), font, font_scale, color, thickness)


def load_image(image_path: str) -> tuple:
    """Load image and return (numpy array, original PIL image)."""
    print(f"\n{'='*60}")
    print(f"Loading image: {image_path}")
    print(f"{'='*60}")
    
    with open(image_path, 'rb') as f:
        image_bytes = f.read()
    
    pil_img = Image.open(BytesIO(image_bytes))
    pil_img = ImageOps.exif_transpose(pil_img)
    pil_img = pil_img.convert("RGB")
    
    print(f"  Original size: {pil_img.size}")
    
    # Scale to processing size
    width, height = pil_img.size
    target_long_edge = 1600
    long_edge = max(width, height)
    scale = target_long_edge / long_edge
    
    if abs(scale - 1.0) > 0.05:
        new_size = (int(width * scale), int(height * scale))
        pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        print(f"  Scaled to: {pil_img.size}")
    
    image = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    return image, image_bytes


def debug_step1_original(image: np.ndarray) -> np.ndarray:
    """Step 1: Save original loaded image."""
    print(f"\n[Step 1] Original Image")
    print(f"  Shape: {image.shape}")
    save_image(image, "01_original.png")
    return image


def debug_step2_fiducial_detection(image: np.ndarray) -> tuple:
    """Step 2: Detect fiducials and visualize."""
    print(f"\n[Step 2] Fiducial Detection")
    
    vis = image.copy()
    height, width = image.shape[:2]
    
    # Run detection
    fiducials = _detect_fiducials(image)
    
    if fiducials is None:
        print("  ✗ Fiducials NOT detected!")
        draw_text_with_bg(vis, "FIDUCIALS NOT FOUND!", (50, 50), 1.0, RED)
        save_image(vis, "02_fiducials_NOT_FOUND.png")
        return None, vis
    
    print(f"  ✓ Detected {len(fiducials)} fiducials:")
    
    # Draw detected fiducials
    colors = {"tl": GREEN, "tr": BLUE, "br": RED, "bl": YELLOW}
    for label, center in fiducials.items():
        cx, cy = int(center[0]), int(center[1])
        color = colors.get(label, WHITE)
        
        # Draw marker
        cv2.circle(vis, (cx, cy), 20, color, 3)
        cv2.drawMarker(vis, (cx, cy), color, cv2.MARKER_CROSS, 40, 2)
        
        # Draw label
        draw_text_with_bg(vis, f"{label.upper()}: ({cx}, {cy})", (cx + 25, cy), 0.6, color)
        print(f"    {label.upper()}: ({cx}, {cy})")
    
    # Draw lines connecting fiducials
    pts = [fiducials["tl"], fiducials["tr"], fiducials["br"], fiducials["bl"]]
    pts = [(int(p[0]), int(p[1])) for p in pts]
    for i in range(4):
        cv2.line(vis, pts[i], pts[(i+1)%4], CYAN, 2)
    
    save_image(vis, "02_fiducials_detected.png")
    return fiducials, vis


def debug_step3_perspective_warp(image: np.ndarray, fiducials: dict) -> np.ndarray:
    """Step 3: Apply perspective warp."""
    print(f"\n[Step 3] Perspective Warp")
    
    if fiducials is None:
        print("  ✗ Skipping - no fiducials")
        # Fallback to deskew
        warped = _deskew(image)
        print(f"  Using deskew fallback. Shape: {warped.shape}")
        save_image(warped, "03_deskewed_fallback.png")
        return warped
    
    # Apply perspective transform
    ordered = np.array(
        [fiducials[label] for label in ("tl", "tr", "br", "bl")],
        dtype=np.float32,
    )
    
    matrix = cv2.getPerspectiveTransform(ordered, _FIDUCIAL_TARGETS)
    warped = cv2.warpPerspective(
        image,
        matrix,
        (_CANONICAL_WIDTH, _CANONICAL_HEIGHT),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    
    print(f"  ✓ Warped to canonical size: {warped.shape}")
    print(f"    Target: {_CANONICAL_WIDTH}x{_CANONICAL_HEIGHT}")
    save_image(warped, "03_warped_canonical.png")
    return warped


def debug_step4_write_areas(warped: np.ndarray) -> np.ndarray:
    """Step 4: Draw all write areas on warped image."""
    print(f"\n[Step 4] Write Area Coordinates")
    print(f"  Grid configuration:")
    print(f"    Row Y positions: {_ROW_Y_POSITIONS}")
    print(f"    Left col X: {_LEFT_COL_X}, Right col X: {_RIGHT_COL_X}")
    print(f"    Write area size: {_WRITE_WIDTH}x{_WRITE_HEIGHT}")
    
    vis = warped.copy()
    
    # Draw each write area
    colors = [GREEN, BLUE, RED, YELLOW, CYAN, MAGENTA, ORANGE, (128, 255, 128), (255, 128, 128), (128, 128, 255)]
    
    print(f"\n  Write areas (NEW field names):")
    for i, area in enumerate(WRITE_AREAS):
        color = colors[i % len(colors)]
        
        # Draw rectangle
        cv2.rectangle(
            vis,
            (area.x, area.y),
            (area.x + area.width, area.y + area.height),
            color,
            2
        )
        
        # Draw field name
        draw_text_with_bg(vis, area.name, (area.x + 5, area.y + 20), 0.5, color, (0, 0, 0))
        
        # Draw coordinates
        coord_text = f"({area.x},{area.y}) {area.width}x{area.height}"
        draw_text_with_bg(vis, coord_text, (area.x + 5, area.y + area.height - 8), 0.35, WHITE, (0, 0, 0))
        
        print(f"    [{i}] {area.name:25s} @ ({area.x:4d}, {area.y:4d}) size {area.width}x{area.height}")
    
    save_image(vis, "04_write_areas_overlay.png")
    return vis


def debug_step5_crop_regions(warped: np.ndarray) -> list:
    """Step 5: Crop and save each write area region."""
    print(f"\n[Step 5] Cropped Write Regions")
    
    crops = []
    for i, area in enumerate(WRITE_AREAS):
        # Crop with bounds checking
        y1 = max(0, area.y)
        y2 = min(warped.shape[0], area.y + area.height)
        x1 = max(0, area.x)
        x2 = min(warped.shape[1], area.x + area.width)
        
        crop = warped[y1:y2, x1:x2].copy()
        crops.append((area.name, crop))
        
        save_image(crop, f"05_crop_{i:02d}_{area.name}.png")
        print(f"    [{i}] {area.name}: shape {crop.shape}")
    
    return crops


def debug_step6_preprocessing(crops: list) -> list:
    """Step 6: Apply OCR preprocessing to each crop."""
    print(f"\n[Step 6] OCR Preprocessing")
    
    processed = []
    for i, (name, crop) in enumerate(crops):
        # Adaptive threshold preprocessing (single-pass)
        proc = _preprocess_for_ocr_simple(crop)
        save_image(proc, f"06_preproc_{i:02d}_{name}.png")
        
        processed.append((name, proc))
        print(f"    [{i}] {name}: processed={proc.shape}")
    
    return processed


def debug_step7_summary_grid(warped: np.ndarray, crops: list) -> np.ndarray:
    """Step 7: Create a summary grid showing all regions."""
    print(f"\n[Step 7] Creating Summary Grid")
    
    # Create a grid showing warped image + all crops
    cell_h, cell_w = 100, 200
    rows, cols = 5, 4  # 5 rows, 4 columns (left crop, left proc, right crop, right proc)
    
    grid = np.ones((rows * cell_h + 50, cols * cell_w, 3), dtype=np.uint8) * 240
    
    # Title
    draw_text_with_bg(grid, "OCR Debug Summary - Cropped Regions & Preprocessing", (10, 30), 0.7, (0, 0, 0), (240, 240, 240))
    
    for row in range(5):
        left_idx = row * 2
        right_idx = row * 2 + 1
        
        for col_offset, idx in enumerate([left_idx, right_idx]):
            if idx < len(crops):
                name, crop = crops[idx]
                
                # Resize crop to fit cell
                h, w = crop.shape[:2]
                scale = min((cell_w - 10) / w, (cell_h - 25) / h)
                new_w, new_h = int(w * scale), int(h * scale)
                resized = cv2.resize(crop, (new_w, new_h))
                
                # Position in grid
                x_offset = col_offset * 2 * cell_w + 5
                y_offset = row * cell_h + 55
                
                # Paste
                if len(resized.shape) == 2:
                    resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)
                grid[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized
                
                # Label
                draw_text_with_bg(grid, name[:15], (x_offset, y_offset + new_h + 15), 0.35, (0, 0, 0), (240, 240, 240))
    
    save_image(grid, "07_summary_grid.png")
    return grid


def run_full_debug(image_path: str):
    """Run the complete debug pipeline."""
    print("\n" + "="*70)
    print("  OCR PIPELINE DEBUG TEST")
    print("  Output directory:", DEBUG_OUTPUT)
    print("="*70)
    
    # Clear old debug files
    for f in DEBUG_OUTPUT.glob("*.png"):
        f.unlink()
    print(f"\n  Cleared old debug files from {DEBUG_OUTPUT}")
    
    # Load image
    image, image_bytes = load_image(image_path)
    
    # Step 1: Original
    debug_step1_original(image)
    
    # Step 2: Fiducial detection
    fiducials, fid_vis = debug_step2_fiducial_detection(image)
    
    # Step 3: Perspective warp
    warped = debug_step3_perspective_warp(image, fiducials)
    
    # Step 4: Draw write areas
    debug_step4_write_areas(warped)
    
    # Step 5: Crop regions
    crops = debug_step5_crop_regions(warped)
    
    # Step 6: Preprocessing
    processed = debug_step6_preprocessing(crops)
    
    # Step 7: Summary grid
    debug_step7_summary_grid(warped, crops)
    
    # Final summary
    print("\n" + "="*70)
    print("  DEBUG COMPLETE")
    print("="*70)
    print(f"\n  Output files saved to: {DEBUG_OUTPUT}")
    print(f"\n  Files created:")
    for f in sorted(DEBUG_OUTPUT.glob("*.png")):
        print(f"    - {f.name}")
    
    print(f"\n  Key files to check:")
    print(f"    1. 02_fiducials_detected.png - Verify fiducial detection")
    print(f"    2. 03_warped_canonical.png   - Check perspective correction")
    print(f"    3. 04_write_areas_overlay.png - VERIFY BOX ALIGNMENT!")
    print(f"    4. 05_crop_*.png             - Individual cropped regions")
    print(f"    5. 06*_preproc_*.png         - Preprocessed for OCR")


if __name__ == "__main__":
    # Default test image path
    if len(sys.argv) > 1:
        test_image = sys.argv[1]
    else:
        # Look for the latest capture from the app
        captures_dir = Path(__file__).parent / "debug_output" / "captures"
        
        # First try "latest" file
        latest_files = list(captures_dir.glob("latest.*"))
        if latest_files:
            test_image = str(latest_files[0])
            print(f"\n  Found latest capture: {test_image}")
        else:
            # Look for most recent capture_* file
            capture_files = list(captures_dir.glob("capture_*.*"))
            if capture_files:
                # Sort by modification time, newest first
                capture_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
                test_image = str(capture_files[0])
                print(f"\n  Found most recent capture: {test_image}")
            else:
                # Fallback to other common locations
                possible_paths = [
                    Path(__file__).parent / "test_capture.png",
                    Path(__file__).parent / "test_capture.jpg",
                    Path(__file__).parent.parent / "test_capture.png",
                    Path(__file__).parent.parent / "test_capture.jpg",
                ]
                
                test_image = None
                for p in possible_paths:
                    if p.exists():
                        test_image = str(p)
                        break
                
                if test_image is None:
                    print("\n" + "="*60)
                    print("  NO CAPTURE FOUND")
                    print("="*60)
                    print("\n  Option 1: Use the app to capture a form")
                    print("            The backend will auto-save it to:")
                    print(f"            {captures_dir}/")
                    print("\n  Option 2: Manually provide an image path:")
                    print("            python debug_ocr_pipeline.py <image_path>")
                    print("\n  Option 3: Save an image as:")
                    print(f"            {Path(__file__).parent / 'test_capture.png'}")
                    sys.exit(1)
    
    run_full_debug(test_image)
