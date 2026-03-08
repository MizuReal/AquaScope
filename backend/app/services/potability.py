from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.core.config import get_settings
from app.services.supabase_client import get_supabase_client

# Lazy import to avoid circular dependency
def _get_microbial_predictor():
    from app.services.microbial_risk import get_microbial_risk_predictor
    return get_microbial_risk_predictor()

logger = logging.getLogger(__name__)

# free_chlorine_residual has been removed from the capture form.
FEATURE_COLUMNS = (
    "ph",
    "hardness",
    "solids",
    "chloramines",
    "sulfate",
    "conductivity",
    "organic_carbon",
    "trihalomethanes",
    "turbidity",
)

FIELD_LABELS = {
    "ph": "pH (dimensionless)",
    "hardness": "Hardness (mg/L as CaCO3)",
    "solids": "Total dissolved solids (mg/L)",
    "chloramines": "Chloramines (mg/L)",
    "sulfate": "Sulfate (mg/L)",
    "conductivity": "Conductivity (µS/cm)",
    "organic_carbon": "Organic carbon (mg/L)",
    "trihalomethanes": "Trihalomethanes (µg/L)",
    "turbidity": "Turbidity (NTU)",
}

DATASET_PATH = Path(__file__).resolve().parents[2] / "water_potability.csv"

COLUMN_MAP = {
    "ph": "ph",
    "Hardness": "hardness",
    "Solids": "solids",
    "Chloramines": "chloramines",
    "Sulfate": "sulfate",
    "Conductivity": "conductivity",
    "Organic_carbon": "organic_carbon",
    "Trihalomethanes": "trihalomethanes",
    "Turbidity": "turbidity",
    "Potability": "is_potable",
}


@dataclass
class ParameterCheck:
    field: str
    label: str
    value: Optional[float]
    status: str
    detail: str
    z_score: Optional[float]
    recommended_range: Optional[List[float]]

    def as_dict(self) -> Dict[str, object]:
        payload = {
            "field": self.field,
            "label": self.label,
            "value": self.value,
            "status": self.status,
            "detail": self.detail,
            "recommended_range": self.recommended_range,
        }
        if self.z_score is not None and np.isfinite(self.z_score):
            payload["z_score"] = round(float(self.z_score), 2)
        else:
            payload["z_score"] = None
        return payload


class PotabilityPredictor:
    def __init__(self, dataset_path: Optional[Path] = None, threshold: float = 0.58) -> None:
        self.dataset_path = Path(dataset_path or DATASET_PATH)
        self.threshold = threshold
        self.settings = get_settings()
        self.samples_table = (self.settings.supabase_samples_table or "").strip()
        self.pipeline = self._train_pipeline()
        self.feature_stats = self._compute_feature_stats()
        self.model_version = "random_forest_v1"

    # ------------------------------------------------------------------
    # Training-data loading: Supabase first, CSV fallback
    # ------------------------------------------------------------------

    def _load_training_frame(self) -> pd.DataFrame:
        """Load training data from Supabase `water_potability`, CSV fallback."""
        client = get_supabase_client()
        if client:
            try:
                df = self._fetch_training_from_supabase(client)
                if not df.empty:
                    logger.info("Loaded %d training rows from Supabase water_potability", len(df))
                    return df
            except Exception:
                logger.exception("Supabase training-data fetch failed")

        # Fallback: local CSV
        if self.dataset_path.exists():
            logger.info("Falling back to local CSV: %s", self.dataset_path)
            df = pd.read_csv(self.dataset_path)
            missing = [src for src in COLUMN_MAP if src not in df.columns]
            if missing:
                raise ValueError(f"Dataset missing expected columns: {', '.join(missing)}")
            df = df.rename(columns=COLUMN_MAP)
            for column in FEATURE_COLUMNS:
                if column not in df.columns:
                    df[column] = np.nan
            return df[list(FEATURE_COLUMNS) + ["is_potable"]]

        raise RuntimeError(
            "No training data available: Supabase fetch failed and local CSV not found at "
            f"{self.dataset_path}"
        )

    def _fetch_training_from_supabase(self, client) -> pd.DataFrame:
        """Paginate over the water_potability table and return a DataFrame."""
        select_cols = ",".join(list(FEATURE_COLUMNS) + ["is_potable"])
        all_rows: list = []
        page_size = 1000
        offset = 0
        while True:
            resp = (
                client.table("water_potability")
                .select(select_cols)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            data = getattr(resp, "data", None) or []
            if not data:
                break
            all_rows.extend(data)
            if len(data) < page_size:
                break
            offset += page_size

        if not all_rows:
            return pd.DataFrame()

        df = pd.DataFrame(all_rows)
        for col in FEATURE_COLUMNS:
            df[col] = pd.to_numeric(df.get(col), errors="coerce") if col in df.columns else np.nan
        df["is_potable"] = (
            df["is_potable"].map({True: 1, False: 0, "true": 1, "false": 0}).fillna(0).astype(float)
            if "is_potable" in df.columns
            else 0
        )
        return df[list(FEATURE_COLUMNS) + ["is_potable"]]

    def _train_pipeline(self) -> Pipeline:
        df = self._load_training_frame()
        X = df[list(FEATURE_COLUMNS)]
        y = df["is_potable"].fillna(0)
        pipeline = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),  # Kept for consistency; RF is scale-invariant
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=200,           # Enough trees for stable predictions
                        max_depth=12,               # Prevent overfitting on small dataset
                        min_samples_split=5,        # Require 5 samples to split a node
                        min_samples_leaf=2,         # Each leaf must have at least 2 samples
                        max_features="sqrt",        # sqrt(n_features) for classification
                        class_weight="balanced",    # Handle class imbalance
                        random_state=42,            # Reproducibility
                        n_jobs=-1,                  # Parallel processing
                        oob_score=True,             # Out-of-bag score for validation
                    ),
                ),
            ]
        )
        pipeline.fit(X, y)
        return pipeline

    def _compute_feature_stats(self) -> Dict[str, Dict[str, float]]:
        df = self._load_training_frame()
        stats: Dict[str, Dict[str, float]] = {}
        for column in FEATURE_COLUMNS:
            series = df[column].dropna()
            if series.empty:
                stats[column] = {
                    "mean": 0.0,
                    "std": 1.0,
                    "min": None,
                    "max": None,
                    "q1": None,
                    "q3": None,
                }
                continue
            stats[column] = {
                "mean": float(series.mean()),
                "std": float(series.std() or 1.0),
                "min": float(series.min()),
                "max": float(series.max()),
                "q1": float(series.quantile(0.25)),
                "q3": float(series.quantile(0.75)),
            }
        return stats

    def score_sample(
        self,
        features: Dict[str, Optional[float]],
        meta: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, object]:
        provided = [value for value in features.values() if value is not None]
        if len(provided) < 3:
            raise ValueError("At least three numeric parameters are required for a stable prediction.")

        row = {}
        for col in FEATURE_COLUMNS:
            value = features.get(col)
            row[col] = np.nan if value is None else float(value)
        frame = pd.DataFrame([row])
        probability = float(self.pipeline.predict_proba(frame)[0][1])
        is_potable = probability >= self.threshold
        risk_level = self._derive_risk(probability)
        checks = [self._build_check(col, features.get(col)) for col in FEATURE_COLUMNS]

        # --- Microbial-risk assessment (integrated) ---
        try:
            microbial_predictor = _get_microbial_predictor()
            microbial_result = microbial_predictor.predict(features, meta)
        except Exception:
            logger.exception("Microbial-risk prediction failed; continuing without it")
            microbial_result = {}

        # --- Microbial safety gate: override potability when pathogen risk is elevated ---
        microbial_risk = microbial_result.get("microbial_risk_level")
        microbial_override = False
        if microbial_risk == "high":
            is_potable = False
            risk_level = "unsafe"
            microbial_override = True
        elif microbial_risk == "medium" and is_potable:
            risk_level = "borderline"

        result = {
            "is_potable": is_potable,
            "probability": round(probability, 4),
            "decision_threshold": float(self.threshold),
            "risk_level": risk_level,
            "model_version": self.model_version,
            "timestamp": datetime.utcnow(),
            "checks": [check.as_dict() for check in checks],
            "missing_features": [col for col in FEATURE_COLUMNS if features.get(col) is None],
            "meta": meta or {},
            "saved": False,
            "sample_id": None,
            "message": self._build_summary(is_potable, risk_level, microbial_override),
            # Microbial risk fields
            "microbial_risk_level": microbial_result.get("microbial_risk_level"),
            "microbial_risk_probabilities": microbial_result.get("microbial_risk_probabilities"),
            "microbial_score": microbial_result.get("microbial_score"),
            "microbial_max_score": microbial_result.get("microbial_max_score"),
            "microbial_violations": microbial_result.get("microbial_violations", []),
            "possible_bacteria": microbial_result.get("possible_bacteria", []),
        }

        sample_id = self._persist_sample(features, meta or {}, result)
        if sample_id:
            result["saved"] = True
            result["sample_id"] = sample_id
        return result

    def _derive_risk(self, probability: float) -> str:
        if probability >= 0.7:
            return "safe"
        if probability >= 0.5:
            return "borderline"
        if probability >= 0.35:
            return "watch"
        return "unsafe"

    def _build_summary(self, is_potable: bool, risk_level: str, microbial_override: bool = False) -> str:
        if microbial_override:
            return "Chemically acceptable but high microbial risk — not potable. Confirmatory lab testing strongly recommended."
        if is_potable and risk_level == "safe":
            return "Sample matches potable water profile with strong confidence."
        if is_potable:
            return "Sample is marginally potable but monitor outlier parameters."
        if risk_level == "watch":
            return "Sample trends toward non-potable; investigate highlighted parameters."
        return "Sample is likely non-potable; escalate for confirmatory testing."

    def _build_check(self, field: str, value: Optional[float]) -> ParameterCheck:
        stats = self.feature_stats[field]
        label = FIELD_LABELS.get(field, field)
        if value is None:
            return ParameterCheck(
                field=field,
                label=label,
                value=None,
                status="missing",
                detail="No reading captured.",
                z_score=None,
                recommended_range=self._recommended_range(stats),
            )

        std = stats["std"] or 1e-9
        z_score = (value - stats["mean"]) / std
        severity = "ok"
        if abs(z_score) >= 2.5:
            severity = "critical"
        elif abs(z_score) >= 1.5:
            severity = "warning"

        direction = "above" if z_score > 0 else "below"
        detail = f"{label} is {abs(z_score):.1f}σ {direction} the dataset mean."

        return ParameterCheck(
            field=field,
            label=label,
            value=float(value),
            status=severity,
            detail=detail,
            z_score=float(z_score),
            recommended_range=self._recommended_range(stats),
        )

    @staticmethod
    def _recommended_range(stats: Dict[str, Optional[float]]) -> Optional[List[float]]:
        low = stats.get("q1")
        high = stats.get("q3")
        if low is None or high is None:
            return None
        if not np.isfinite(low) or not np.isfinite(high):
            return None
        return [float(low), float(high)]

    def _persist_sample(
        self,
        features: Dict[str, Optional[float]],
        meta: Dict[str, Optional[str]],
        result: Dict[str, object],
    ) -> Optional[str]:
        client = get_supabase_client()
        if not client or not self.samples_table:
            return None

        record: Dict[str, object] = {
            **{key: features.get(key) for key in FEATURE_COLUMNS},
            "color": meta.get("color"),
            "source": meta.get("source"),
            "sample_label": meta.get("sample_label"),
            "user_id": meta.get("user_id"),
            "notes": meta.get("notes"),
            "prediction_probability": result["probability"],
            "prediction_is_potable": result["is_potable"],
            "risk_level": result["risk_level"],
            "microbial_risk": result.get("microbial_risk_level"),
            "microbial_score": result.get("microbial_score"),
            "possible_bacteria": result.get("possible_bacteria", []),
            "model_version": result["model_version"],
            "anomaly_checks": result["checks"],
        }

        try:
            response = client.table(self.samples_table).insert(record).select("id").execute()
            data = getattr(response, "data", None) or []
            if data:
                return data[0].get("id") or data[0].get("uuid")
        except Exception:
            logger.exception("Failed to persist sample to Supabase")
        return None


@lru_cache(maxsize=1)
def get_potability_predictor() -> PotabilityPredictor:
    return PotabilityPredictor()
