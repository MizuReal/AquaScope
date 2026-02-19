"""Moss classification service using TorchScript model.

Classes: Clean | HeavyMoss | LightMoss | MediumMoss
Model: YOLOv8x-cls exported to TorchScript (224x224 input)
"""

from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

# Class labels in the order the model was trained on
CLASS_NAMES: List[str] = ["Clean", "HeavyMoss", "LightMoss", "MediumMoss"]

# Out-of-domain rejection thresholds (matches training notebook cell 13)
CONFIDENCE_THRESHOLD = 0.85   # minimum top-class softmax probability
ENTROPY_THRESHOLD = 0.6       # max allowed Shannon entropy (uniform 4-class ≈ 1.39)

# Resolve model path relative to project root
_MODEL_PATH = Path(__file__).resolve().parents[3] / "moss_model" / "best.torchscript"

# Singleton model handle
_model: torch.jit.ScriptModule | None = None


def _load_model() -> torch.jit.ScriptModule:
    """Load TorchScript model once and cache it."""
    global _model
    if _model is not None:
        return _model

    if not _MODEL_PATH.exists():
        raise FileNotFoundError(f"Moss TorchScript model not found at {_MODEL_PATH}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Loading moss classifier from %s (device=%s)", _MODEL_PATH, device)
    _model = torch.jit.load(str(_MODEL_PATH), map_location=device)
    _model.eval()
    logger.info("Moss classifier loaded successfully")
    return _model


def _preprocess(image_bytes: bytes) -> torch.Tensor:
    """Convert raw image bytes to a normalised 224x224 tensor [1, 3, 224, 224]."""
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
    model = _load_model()
    device = next(model.parameters()).device
    tensor = _preprocess(image_bytes).to(device)

    with torch.no_grad():
        output = model(tensor)

    # YOLOv8-cls TorchScript output is a tensor of shape [1, num_classes]
    probs = torch.softmax(output, dim=1).squeeze(0).cpu().numpy()

    top_idx = int(np.argmax(probs))
    top_conf = float(probs[top_idx])
    entropy = _shannon_entropy(probs)

    # Rejection gate: low confidence OR high entropy → not a valid container image
    is_valid = top_conf >= CONFIDENCE_THRESHOLD and entropy <= ENTROPY_THRESHOLD

    probabilities = {name: round(float(probs[i]), 4) for i, name in enumerate(CLASS_NAMES)}

    predicted_class = CLASS_NAMES[top_idx] if is_valid else "Unknown"

    logger.info(
        "Moss classification: class=%s conf=%.2f%% entropy=%.3f valid=%s",
        CLASS_NAMES[top_idx], top_conf * 100, entropy, is_valid,
    )

    return {
        "predicted_class": predicted_class,
        "confidence": round(top_conf, 4),
        "probabilities": probabilities,
        "entropy": round(entropy, 4),
        "is_valid": is_valid,
    }
