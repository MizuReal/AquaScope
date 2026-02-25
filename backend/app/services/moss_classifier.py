"""Moss classification service using TorchScript model.

Classes: Clean | HeavyMoss | LightMoss | MediumMoss
Model: YOLOv8x-cls exported to TorchScript (224x224 input)
"""

from __future__ import annotations

import logging
import os
from io import BytesIO
from pathlib import Path
from typing import Dict, List
from urllib.request import urlopen

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Class labels in the order the model was trained on
CLASS_NAMES: List[str] = ["Clean", "HeavyMoss", "LightMoss", "MediumMoss"]

# Out-of-domain rejection thresholds
CONFIDENCE_THRESHOLD = 0.85   # minimum top-class softmax probability
ENTROPY_THRESHOLD    = 0.6    # max allowed Shannon entropy (uniform 4-class ≈ 1.39)
MARGIN_THRESHOLD     = 0.25   # minimum gap between top-1 and top-2 probability
                              # catches random images where the model hedges between classes

# Resolve model paths relative to project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_MODEL_TS = _PROJECT_ROOT / "moss_model" / "best.torchscript"
_LOCAL_MODEL_PT = _PROJECT_ROOT / "moss_model" / "best.pt"

# Environment variables (Render/Hugging Face mounting)
_MODEL_URL_TS = os.getenv("MODEL_URL_TS")
_MODEL_URL_PT = os.getenv("MODEL_URL_PT")
_MODEL_PATH_TS_ENV = os.getenv("MODEL_PATH_TS")
_MODEL_PATH_PT_ENV = os.getenv("MODEL_PATH_PT")

# Default runtime storage path for ephemeral instances (Render free tier)
_RUNTIME_MODEL_DIR = Path(os.getenv("MODEL_DIR", "/tmp/models"))

# Resolved runtime paths
_MODEL_TS_PATH: Path | None = None
_MODEL_PT_PATH: Path | None = None

# Singleton model handle
_model = None


def _download_file(url: str, destination: Path) -> Path:
    """Download a remote model artifact to destination if needed."""
    destination.parent.mkdir(parents=True, exist_ok=True)

    logger.info("Downloading model artifact: %s -> %s", url, destination)
    with urlopen(url, timeout=180) as response, destination.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)

    logger.info("Model artifact downloaded: %s", destination)
    return destination


def _resolve_artifact_paths() -> tuple[Path, Path]:
    """Resolve and ensure availability of both TS and PT artifacts.

    Priority order:
      1) Explicit MODEL_PATH_* env vars
      2) Runtime path under /tmp/models when MODEL_URL_* is set
      3) Repository local fallback under moss_model/
    """
    global _MODEL_TS_PATH, _MODEL_PT_PATH
    if _MODEL_TS_PATH is not None and _MODEL_PT_PATH is not None:
        return _MODEL_TS_PATH, _MODEL_PT_PATH

    ts_path = Path(_MODEL_PATH_TS_ENV) if _MODEL_PATH_TS_ENV else (
        _RUNTIME_MODEL_DIR / "best.torchscript" if _MODEL_URL_TS else _LOCAL_MODEL_TS
    )
    pt_path = Path(_MODEL_PATH_PT_ENV) if _MODEL_PATH_PT_ENV else (
        _RUNTIME_MODEL_DIR / "best.pt" if _MODEL_URL_PT else _LOCAL_MODEL_PT
    )

    if _MODEL_URL_TS and not ts_path.exists():
        _download_file(_MODEL_URL_TS, ts_path)
    if _MODEL_URL_PT and not pt_path.exists():
        _download_file(_MODEL_URL_PT, pt_path)

    _MODEL_TS_PATH = ts_path
    _MODEL_PT_PATH = pt_path
    return _MODEL_TS_PATH, _MODEL_PT_PATH


def _load_model():
    """Load TorchScript model once and cache it."""
    global _model
    if _model is not None:
        return _model

    import torch

    model_ts_path, _ = _resolve_artifact_paths()
    if not model_ts_path.exists():
        raise FileNotFoundError(
            "Moss TorchScript model not found. "
            f"Checked path: {model_ts_path}. "
            "Set MODEL_URL_TS for remote download or provide local moss_model/best.torchscript."
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Loading moss classifier from %s (device=%s)", model_ts_path, device)
    _model = torch.jit.load(str(model_ts_path), map_location=device)
    _model.eval()
    logger.info("Moss classifier loaded successfully")
    return _model


def _preprocess(image_bytes: bytes):
    """Convert raw image bytes to a normalised 224x224 tensor [1, 3, 224, 224].

    Matches YOLOv8-cls preprocessing exactly:
      1. Resize to 224x224 (LANCZOS)
      2. Scale pixels to [0, 1]  ← only step; YOLOv8 does NOT use ImageNet mean/std
    """
    import torch

    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    img = img.resize((224, 224), Image.LANCZOS)

    arr = np.array(img, dtype=np.float32) / 255.0  # [H, W, C] in [0, 1]
    tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)  # [1, 3, H, W]
    return tensor


def _shannon_entropy(probs: np.ndarray) -> float:
    """Compute Shannon entropy of a probability distribution."""
    p = np.clip(probs, 1e-10, 1.0)
    return float(-np.sum(p * np.log(p)))


def classify(image_bytes: bytes) -> Dict:
    """Run moss classification on raw image bytes.

    Applies out-of-domain rejection (matches training notebook):
      - confidence < 85 %  → rejected
      - entropy   > 0.6    → rejected
    Rejected images are returned with predicted_class="Unknown".

    Returns
    -------
    dict with keys:
        predicted_class : str   – top-1 class label or "Unknown"
        confidence      : float – top-1 softmax probability (0-1)
        probabilities   : dict  – {class_name: probability} for all classes
        entropy         : float – Shannon entropy of the distribution
        is_valid        : bool  – whether the prediction passed rejection gates
    """
    import torch

    model = _load_model()
    device = next(model.parameters()).device
    tensor = _preprocess(image_bytes).to(device)

    with torch.no_grad():
        output = model(tensor)

    # YOLOv8-cls TorchScript models include softmax in the exported graph —
    # the output is already a probability distribution summing to 1.
    # Applying softmax again would corrupt the scores (double-softmax shrinks
    # a 99 % confident prediction down to ~47 %, failing the rejection gate).
    raw = output.squeeze(0).cpu()
    if raw.sum().item() > 1.01:
        # Fallback: output appears to be raw logits — apply softmax once.
        raw = torch.softmax(raw, dim=0)
    probs = raw.numpy()

    sorted_idx = np.argsort(probs)[::-1]   # indices sorted high→low
    top_idx    = int(sorted_idx[0])
    top_conf   = float(probs[top_idx])
    second_conf = float(probs[sorted_idx[1]])
    margin     = top_conf - second_conf
    entropy    = _shannon_entropy(probs)

    # ── Rejection gates ───────────────────────────────────────────────────
    # All three conditions must pass for the prediction to be accepted.
    # A completely unrelated image (random noise, a face, a landscape, etc.)
    # will typically fail at least one gate:
    #   • low confidence  – model is not certain of any class
    #   • high entropy    – probability mass spread across all classes
    #   • low margin      – model hedges almost equally between two classes
    rejection_reason: str | None = None
    if top_conf < CONFIDENCE_THRESHOLD:
        rejection_reason = f"Confidence too low ({top_conf*100:.0f}% < {CONFIDENCE_THRESHOLD*100:.0f}%)"
    elif entropy > ENTROPY_THRESHOLD:
        rejection_reason = f"Prediction too uncertain (entropy {entropy:.2f} > {ENTROPY_THRESHOLD})"
    elif margin < MARGIN_THRESHOLD:
        rejection_reason = f"Ambiguous result — scores too close ({top_conf*100:.0f}% vs {second_conf*100:.0f}%)"

    is_valid = rejection_reason is None
    probabilities = {name: round(float(probs[i]), 4) for i, name in enumerate(CLASS_NAMES)}
    predicted_class = CLASS_NAMES[top_idx] if is_valid else "Unknown"

    # Zero-out confidence when rejected so the frontend never displays a
    # misleading percentage for an unrecognised image.
    reported_confidence = round(top_conf, 4) if is_valid else 0.0

    logger.info(
        "Moss classification: class=%s conf=%.2f%% margin=%.2f entropy=%.3f valid=%s reason=%s",
        CLASS_NAMES[top_idx], top_conf * 100, margin, entropy, is_valid, rejection_reason,
    )

    return {
        "predicted_class": predicted_class,
        "confidence": reported_confidence,
        "probabilities": probabilities,
        "entropy": round(entropy, 4),
        "margin": round(margin, 4),
        "is_valid": is_valid,
        "rejection_reason": rejection_reason,  # None when valid, human-readable string when rejected
    }
