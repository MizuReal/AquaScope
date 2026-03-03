from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, validator


class WaterSamplePayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_by_name=True)
    ph: Optional[float] = Field(None, alias="pH")
    hardness: Optional[float] = None
    solids: Optional[float] = None
    chloramines: Optional[float] = None
    sulfate: Optional[float] = None
    conductivity: Optional[float] = None
    organic_carbon: Optional[float] = Field(None, alias="organicCarbon")
    trihalomethanes: Optional[float] = None
    turbidity: Optional[float] = None

    color: Optional[str] = None
    source: Optional[str] = None
    sample_label: Optional[str] = Field(None, alias="sampleLabel")
    user_id: Optional[str] = Field(None, alias="userId")
    notes: Optional[str] = None

    @validator(
        "color",
        "source",
        "sample_label",
        "user_id",
        "notes",
        pre=True,
        always=True,
    )
    def _empty_to_none(cls, value: Optional[str]) -> Optional[str]:  # noqa: N805
        if value is None:
            return None
        value = str(value).strip()
        return value or None

    def feature_dict(self) -> Dict[str, Optional[float]]:
        return {
            "ph": self.ph,
            "hardness": self.hardness,
            "solids": self.solids,
            "chloramines": self.chloramines,
            "sulfate": self.sulfate,
            "conductivity": self.conductivity,
            "organic_carbon": self.organic_carbon,
            "trihalomethanes": self.trihalomethanes,
            "turbidity": self.turbidity,
        }

    def meta_dict(self) -> Dict[str, Optional[str]]:
        return {
            "color": self.color,
            "source": self.source,
            "sample_label": self.sample_label,
            "user_id": self.user_id,
            "notes": self.notes,
        }


class ParameterCheck(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_by_name=True)
    field: str
    label: str
    value: Optional[float]
    status: str
    detail: str
    z_score: Optional[float] = Field(None, alias="zScore")
    recommended_range: Optional[List[float]] = Field(None, alias="recommendedRange")


class MicrobialViolationItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_by_name=True)
    field: str
    rule: str
    value: Optional[float]
    weight: int
    bacteria: List[str]
    health_risk: str = Field("", alias="healthRisk")
    biofilm: str = ""
    unit: str = ""


class MicrobialRiskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_by_name=True)
    microbial_risk_level: str = Field(..., alias="microbialRiskLevel")
    microbial_risk_probabilities: Dict[str, float] = Field(..., alias="microbialRiskProbabilities")
    microbial_score: int = Field(..., alias="microbialScore")
    microbial_max_score: int = Field(..., alias="microbialMaxScore")
    microbial_violations: List[MicrobialViolationItem] = Field(
        default_factory=list, alias="microbialViolations"
    )
    possible_bacteria: List[str] = Field(default_factory=list, alias="possibleBacteria")
    predicted_by_model: bool = Field(..., alias="predictedByModel")
    model_version: str = Field(..., alias="modelVersion")
    timestamp: str


class PotabilityResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_by_name=True)
    is_potable: bool = Field(..., alias="isPotable")
    probability: float
    decision_threshold: float = Field(..., alias="decisionThreshold")
    risk_level: str = Field(..., alias="riskLevel")
    model_version: str = Field(..., alias="modelVersion")
    timestamp: datetime
    checks: List[ParameterCheck]
    missing_features: List[str] = Field(..., alias="missingFeatures")
    meta: Dict[str, Optional[str]]
    saved: bool
    sample_id: Optional[str] = Field(None, alias="sampleId")
    message: str
    # Microbial risk fields (integrated into potability response)
    microbial_risk_level: Optional[str] = Field(None, alias="microbialRiskLevel")
    microbial_risk_probabilities: Optional[Dict[str, float]] = Field(None, alias="microbialRiskProbabilities")
    microbial_score: Optional[int] = Field(None, alias="microbialScore")
    microbial_max_score: Optional[int] = Field(None, alias="microbialMaxScore")
    microbial_violations: List[MicrobialViolationItem] = Field(
        default_factory=list, alias="microbialViolations"
    )
    possible_bacteria: List[str] = Field(default_factory=list, alias="possibleBacteria")

