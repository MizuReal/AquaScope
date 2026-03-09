"""Quick validation: confirm that high-microbial-risk samples are no longer marked potable."""
import os, sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass

from app.services.potability import get_potability_predictor

get_potability_predictor.cache_clear()
pred = get_potability_predictor()

# Sample designed to trigger high microbial risk (multiple WHO violations)
features = {
    "ph": 9.5,
    "hardness": 180.0,
    "solids": 15000.0,
    "chloramines": 10.5,
    "sulfate": 300.0,
    "conductivity": 400.0,
    "organic_carbon": 22.0,
    "trihalomethanes": 60.0,
    "turbidity": 5.5,
}

result = pred.score_sample(features)

print("=== VALIDATION RESULT ===")
print("is_potable:     ", result["is_potable"])
print("probability:    ", result["probability"])
print("risk_level:     ", result["risk_level"])
print("microbial_risk: ", result["microbial_risk_level"])
print("microbial_score:", result["microbial_score"], "/", result["microbial_max_score"])
print("message:        ", result["message"])
print()

if result["microbial_risk_level"] == "high" and result["is_potable"]:
    print("FAIL: Still getting Potable + High microbial risk!")
elif result["microbial_risk_level"] == "high" and not result["is_potable"]:
    print("PASS: High microbial risk correctly forces not potable.")
else:
    print("INFO: Microbial risk is", result["microbial_risk_level"], "(not high for this sample).")
