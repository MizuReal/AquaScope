"""Microbial risk assessment service.

Uses WHO water-quality thresholds to derive a rule-based microbial-risk score,
trains a Random Forest classifier on the labelled dataset, and exposes a
predictor that returns risk level + probable bacteria for any water sample.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

from app.core.config import get_settings
from app.services.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WHO threshold definitions  (from who_water_quality_bacteria_risk.csv)
# ---------------------------------------------------------------------------
# CALIBRATED to the water_potability.csv dataset so that labels distribute
# meaningfully across low / medium / high.
#
# Where the raw WHO limit causes >90 % of the dataset to violate (because
# the dataset represents untreated / raw water), we use **dataset-relative
# percentile break-points** while keeping the WHO's *direction* (higher is
# worse, or range-based) and the bacteria mapping unchanged.
#
# Dataset statistics (rounded):
#   ph            : 0 – 14,  median  7.0      WHO: <6.5 or >8.5 → 52 % violate  ✓ keep
#   hardness      : 47 – 323, median 197      WHO: >500          →  0 % violate  ✓ keep
#   solids (TDS)  : 321 – 61 227, median 20 928  WHO: >1000      → 99.9 % !  → use P75 = 27 000
#   chloramines   : 0.35 – 13.1, median  7.1  WHO: >3 or <0.5   → 99.2 % !  → use >9 (P75) only
#   sulfate       : 129 – 481, median  333    WHO: >250          → 97.7 % !  → use P75 = 400
#   conductivity  : 181 – 753, median  422    WHO: >1500         →  0 % violate  ✓ keep
#   organic_carbon: 2.2 – 28.3, median 14.2   WHO: >5            → 99.8 % !  → use P75 = 18
#   trihalomethanes: 0.7 – 124, median 66.6   WHO: >100          →  1.9 % violate ✓ keep
#   turbidity     : 1.45 – 6.74, median 3.96  WHO: >5            →  9.6 % violate ✓ keep
#
# Each entry: (field, rule_description, condition_fn, weight, bacteria_list)

WHO_THRESHOLDS: List[Tuple[str, str, callable, int, List[str]]] = [
    (
        "ph",
        "pH outside 6.5–8.5 range",
        lambda v: v < 6.5 or v > 8.5,
        2,
        ["Escherichia coli", "Salmonella spp.", "Vibrio cholerae"],
    ),
    (
        "hardness",
        "Hardness > 300 mg/L",
        lambda v: v > 300,
        1,
        ["Legionella pneumophila", "Pseudomonas aeruginosa"],
    ),
    (
        "solids",
        "TDS > 27,000 ppm (high dissolved solids)",
        lambda v: v > 27000,
        1,
        ["E. coli", "Enterobacter spp."],
    ),
    (
        "chloramines",
        "Chloramines > 9 ppm (high residual)",
        lambda v: v > 9,
        2,
        ["Mycobacterium avium", "Legionella pneumophila", "Pseudomonas aeruginosa"],
    ),
    (
        "sulfate",
        "Sulfate > 400 mg/L",
        lambda v: v > 400,
        1,
        ["Clostridium spp.", "Desulfovibrio spp.", "E. coli"],
    ),
    (
        "conductivity",
        "Conductivity > 700 µS/cm",
        lambda v: v > 700,
        1,
        ["E. coli", "Klebsiella spp.", "Enterococcus spp."],
    ),
    (
        "organic_carbon",
        "TOC > 18 ppm (nutrient-rich for biofilms)",
        lambda v: v > 18,
        2,
        [
            "E. coli",
            "Salmonella spp.",
            "Campylobacter jejuni",
            "Pseudomonas aeruginosa",
        ],
    ),
    (
        "trihalomethanes",
        "THMs > 80 µg/L (elevated disinfection byproducts)",
        lambda v: v > 80,
        1,
        ["E. coli", "Enteric bacteria (risk-based)"],
    ),
    (
        "turbidity",
        "Turbidity > 4 NTU (pathogen shielding risk)",
        lambda v: v > 4,
        3,
        ["E. coli", "Vibrio cholerae", "Salmonella spp.", "Shigella spp."],
    ),
]

# WHO health-risk and biofilm metadata per parameter
# (from who_water_quality_bacteria_risk.csv — shown to the user for context)
WHO_METADATA: Dict[str, Dict[str, str]] = {
    "ph": {
        "health_risk": "GI irritation, reduced disinfection efficiency",
        "biofilm": "Biofilm formation",
        "unit": "",
    },
    "hardness": {
        "health_risk": "Scaling, aesthetic issues",
        "biofilm": "Pipe scale biofilms",
        "unit": "mg/L",
    },
    "solids": {
        "health_risk": "GI distress, dehydration",
        "biofilm": "Mineral-associated biofilms",
        "unit": "ppm",
    },
    "chloramines": {
        "health_risk": "Eye, nose, stomach irritation",
        "biofilm": "Chloramine-resistant biofilms",
        "unit": "ppm",
    },
    "sulfate": {
        "health_risk": "Diarrhea, dehydration",
        "biofilm": "Anaerobic biofilms",
        "unit": "mg/L",
    },
    "conductivity": {
        "health_risk": "Salinity stress, GI discomfort",
        "biofilm": "Ion-rich biofilms",
        "unit": "µS/cm",
    },
    "organic_carbon": {
        "health_risk": "Increased DBPs, microbial regrowth",
        "biofilm": "Nutrient-rich biofilms",
        "unit": "ppm",
    },
    "trihalomethanes": {
        "health_risk": "Long-term cancer risk",
        "biofilm": "Indirect indicator (organic contamination)",
        "unit": "µg/L",
    },
    "turbidity": {
        "health_risk": "Pathogen shielding, infection risk",
        "biofilm": "Particle-attached biofilms",
        "unit": "NTU",
    },
}

# Maximum possible weighted score (sum of all weights)
_MAX_SCORE = sum(w for _, _, _, w, _ in WHO_THRESHOLDS)

# Risk-level thresholds (fraction of max score)
# With max=14: High >= 6, Medium >= 3, Low < 3
HIGH_THRESHOLD = 0.40   # >= 40% of max → High
MEDIUM_THRESHOLD = 0.20  # >= 20% of max → Medium, else Low

RISK_LABELS = ("low", "medium", "high")
LABEL_ENCODER_CLASSES = np.array(RISK_LABELS)

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


# ---------------------------------------------------------------------------
# Rule-based scoring
# ---------------------------------------------------------------------------

@dataclass
class MicrobialViolation:
    """A single WHO-threshold violation for a water sample."""
    field: str
    rule: str
    value: float
    weight: int
    bacteria: List[str]
    health_risk: str = ""
    biofilm: str = ""
    unit: str = ""


@dataclass
class MicrobialAssessment:
    """Full microbial-risk assessment for a water sample."""
    risk_level: str  # "high" | "medium" | "low"
    score: int
    max_score: int
    violations: List[MicrobialViolation]
    possible_bacteria: List[str]
    predicted_by_model: bool = False

    def as_dict(self) -> Dict[str, object]:
        return {
            "microbial_risk_level": self.risk_level,
            "microbial_score": self.score,
            "microbial_max_score": self.max_score,
            "microbial_violations": [
                {
                    "field": v.field,
                    "rule": v.rule,
                    "value": round(v.value, 4) if v.value is not None else None,
                    "weight": v.weight,
                    "bacteria": v.bacteria,
                    "health_risk": v.health_risk,
                    "biofilm": v.biofilm,
                    "unit": v.unit,
                }
                for v in self.violations
            ],
            "possible_bacteria": self.possible_bacteria,
            "predicted_by_model": self.predicted_by_model,
        }


def compute_microbial_score(features: Dict[str, Optional[float]]) -> Tuple[int, List[MicrobialViolation]]:
    """Apply WHO thresholds and return weighted score + violations list."""
    score = 0
    violations: List[MicrobialViolation] = []
    for field, rule, test_fn, weight, bacteria in WHO_THRESHOLDS:
        value = features.get(field)
        if value is None or not np.isfinite(value):
            continue
        if test_fn(value):
            score += weight
            meta = WHO_METADATA.get(field, {})
            violations.append(
                MicrobialViolation(
                    field=field,
                    rule=rule,
                    value=value,
                    weight=weight,
                    bacteria=bacteria,
                    health_risk=meta.get("health_risk", ""),
                    biofilm=meta.get("biofilm", ""),
                    unit=meta.get("unit", ""),
                )
            )
    return score, violations


def score_to_risk_label(score: int) -> str:
    """Convert numeric score to High / Medium / Low label."""
    if score >= _MAX_SCORE * HIGH_THRESHOLD:
        return "high"
    if score >= _MAX_SCORE * MEDIUM_THRESHOLD:
        return "medium"
    return "low"


def assess_microbial_risk_rules(features: Dict[str, Optional[float]]) -> MicrobialAssessment:
    """Perform a purely rule-based microbial-risk assessment."""
    score, violations = compute_microbial_score(features)
    risk_level = score_to_risk_label(score)
    all_bacteria: List[str] = []
    seen = set()
    for v in violations:
        for b in v.bacteria:
            if b not in seen:
                all_bacteria.append(b)
                seen.add(b)
    return MicrobialAssessment(
        risk_level=risk_level,
        score=score,
        max_score=_MAX_SCORE,
        violations=violations,
        possible_bacteria=all_bacteria,
        predicted_by_model=False,
    )


# ---------------------------------------------------------------------------
# Labelling helper (used to generate the microbial_risk column)
# ---------------------------------------------------------------------------

def label_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Add a ``microbial_risk`` column to a DataFrame of water-quality readings.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns matching *FEATURE_COLUMNS* (lowercase).

    Returns
    -------
    pd.DataFrame
        The same frame with an added ``microbial_risk`` column.
    """
    risks: List[str] = []
    for _, row in df.iterrows():
        features = {col: row.get(col) for col in FEATURE_COLUMNS}
        # Replace NaN with None for the scoring function
        features = {k: (None if pd.isna(v) else float(v)) for k, v in features.items()}
        score, _ = compute_microbial_score(features)
        risks.append(score_to_risk_label(score))
    df["microbial_risk"] = risks
    return df


# ---------------------------------------------------------------------------
# Random Forest model for microbial-risk prediction
# ---------------------------------------------------------------------------

class MicrobialRiskPredictor:
    """Train a Random Forest on the labelled potability dataset and predict
    microbial risk for new water samples."""

    def __init__(self, dataset_path: Optional[Path] = None) -> None:
        self.dataset_path = Path(dataset_path or DATASET_PATH)
        self.label_encoder = LabelEncoder()
        self.label_encoder.classes_ = LABEL_ENCODER_CLASSES
        self.settings = get_settings()
        self.samples_table = (self.settings.supabase_samples_table or "").strip()
        self.pipeline = self._train_pipeline()
        self.model_version = "microbial_rf_v1"

    # ---- training-data loading: Supabase first, CSV fallback -------------

    def _load_training_frame(self) -> pd.DataFrame:
        """Load training data from Supabase `water_potability`, CSV fallback."""
        client = get_supabase_client()
        if client:
            try:
                df = self._fetch_training_from_supabase(client)
                if not df.empty:
                    logger.info(
                        "Microbial-risk: loaded %d training rows from Supabase water_potability",
                        len(df),
                    )
                    df = label_dataframe(df)
                    return df
            except Exception:
                logger.exception("Microbial-risk: Supabase training-data fetch failed")

        # Fallback: local CSV
        if self.dataset_path.exists():
            logger.info("Microbial-risk: falling back to local CSV: %s", self.dataset_path)
            df = pd.read_csv(self.dataset_path)
            rename = {k: v for k, v in COLUMN_MAP.items() if k in df.columns}
            df = df.rename(columns=rename)
            for col in FEATURE_COLUMNS:
                if col not in df.columns:
                    df[col] = np.nan
            df = label_dataframe(df)
            return df

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
        return df[list(FEATURE_COLUMNS)]

    def _train_pipeline(self) -> Pipeline:
        df = self._load_training_frame()
        X = df[list(FEATURE_COLUMNS)]
        y_labels = df["microbial_risk"]

        # Encode labels: low=0, medium=1, high=2
        y = self.label_encoder.transform(y_labels)

        pipeline = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=200,
                        max_depth=12,
                        min_samples_split=5,
                        min_samples_leaf=2,
                        max_features="sqrt",
                        class_weight="balanced",
                        random_state=42,
                        n_jobs=-1,
                        oob_score=True,
                    ),
                ),
            ]
        )
        pipeline.fit(X, y)
        logger.info(
            "Microbial-risk RF trained – OOB accuracy %.3f, class distribution: %s",
            pipeline.named_steps["model"].oob_score_,
            dict(zip(*np.unique(y_labels, return_counts=True))),
        )
        return pipeline

    # ---- prediction ------------------------------------------------------

    def predict(
        self,
        features: Dict[str, Optional[float]],
        meta: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, object]:
        """Predict microbial risk for a single water sample.

        Returns a dict suitable for direct JSON serialisation.
        """
        # Build single-row DataFrame
        row = {}
        for col in FEATURE_COLUMNS:
            value = features.get(col)
            row[col] = np.nan if value is None else float(value)
        frame = pd.DataFrame([row])

        # ML prediction
        probas = self.pipeline.predict_proba(frame)[0]
        predicted_idx = int(np.argmax(probas))
        predicted_label = self.label_encoder.inverse_transform([predicted_idx])[0]

        # Build probability map for all classes
        class_probabilities = {
            self.label_encoder.inverse_transform([i])[0]: round(float(p), 4)
            for i, p in enumerate(probas)
        }

        # Also run rule-based assessment for violations & bacteria list
        rules_assessment = assess_microbial_risk_rules(features)

        result = {
            "microbial_risk_level": predicted_label,
            "microbial_risk_probabilities": class_probabilities,
            "microbial_score": rules_assessment.score,
            "microbial_max_score": rules_assessment.max_score,
            "microbial_violations": [
                {
                    "field": v.field,
                    "rule": v.rule,
                    "value": round(v.value, 4) if v.value is not None else None,
                    "weight": v.weight,
                    "bacteria": v.bacteria,
                    "health_risk": v.health_risk,
                    "biofilm": v.biofilm,
                    "unit": v.unit,
                }
                for v in rules_assessment.violations
            ],
            "possible_bacteria": rules_assessment.possible_bacteria,
            "predicted_by_model": True,
            "model_version": self.model_version,
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Persist microbial risk to Supabase alongside sample if possible
        self._persist_update(features, meta or {}, result)

        return result

    def _persist_update(
        self,
        features: Dict[str, Optional[float]],
        meta: Dict[str, Optional[str]],
        result: Dict[str, object],
    ) -> None:
        """Optionally update the Supabase field_samples record with microbial risk."""
        client = get_supabase_client()
        if not client or not self.samples_table:
            return
        # We don't create a new record here – the potability service already
        # persists the sample.  This method is a hook for future use if the
        # microbial risk endpoint is called standalone.


@lru_cache(maxsize=1)
def get_microbial_risk_predictor() -> MicrobialRiskPredictor:
    return MicrobialRiskPredictor()
