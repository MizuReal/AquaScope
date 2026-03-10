#!/usr/bin/env python3
"""Generate comprehensive model visualisation charts for thesis defense.

Produces PNG charts in docs/charts/ covering:
  1. Feature Importance (both models)
  2. Confusion Matrices (both models, OOB predictions)
  3. Class Distribution (Potability + Microbial Risk)
  4. ROC Curves (Potability binary + Microbial Risk per-class)
  5. Precision-Recall Curves
  6. Microbial Risk Score Distribution Histogram
  7. Feature Correlation Heatmap
  8. Per-Class Probability Distributions (confidence)
  9. Calibration Curve (Potability)
 10. Feature Percentile Box Plots
"""

from __future__ import annotations
import os, sys, warnings
from pathlib import Path

# Allow importing app modules
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns

from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    confusion_matrix, classification_report, roc_curve, auc,
    precision_recall_curve, average_precision_score,
    ConfusionMatrixDisplay,
)
from sklearn.calibration import calibration_curve
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder, label_binarize

warnings.filterwarnings("ignore")

# ---------- paths ----------
CSV_PATH = Path(__file__).resolve().parent.parent / "csv-files" / "water_potability.csv"
CHARTS_DIR = Path(__file__).resolve().parent / "charts"
CHARTS_DIR.mkdir(exist_ok=True)

FEATURE_COLUMNS = [
    "ph", "hardness", "solids", "chloramines", "sulfate",
    "conductivity", "organic_carbon", "trihalomethanes", "turbidity",
]
FEATURE_LABELS = {
    "ph": "pH", "hardness": "Hardness", "solids": "TDS",
    "chloramines": "Chloramines", "sulfate": "Sulfate",
    "conductivity": "Conductivity", "organic_carbon": "Organic Carbon",
    "trihalomethanes": "THMs", "turbidity": "Turbidity",
}
COLUMN_MAP = {
    "ph": "ph", "Hardness": "hardness", "Solids": "solids",
    "Chloramines": "chloramines", "Sulfate": "sulfate",
    "Conductivity": "conductivity", "Organic_carbon": "organic_carbon",
    "Trihalomethanes": "trihalomethanes", "Turbidity": "turbidity",
    "Potability": "is_potable",
}

# WHO thresholds (calibrated) — replicated from microbial_risk.py
WHO_THRESHOLDS = [
    ("ph", lambda v: v < 6.5 or v > 8.5, 2),
    ("hardness", lambda v: v > 300, 1),
    ("solids", lambda v: v > 27000, 1),
    ("chloramines", lambda v: v > 9, 2),
    ("sulfate", lambda v: v > 400, 1),
    ("conductivity", lambda v: v > 700, 1),
    ("organic_carbon", lambda v: v > 18, 2),
    ("trihalomethanes", lambda v: v > 80, 1),
    ("turbidity", lambda v: v > 4, 3),
]
_MAX_SCORE = sum(w for _, _, w in WHO_THRESHOLDS)

RISK_LABELS = ["low", "medium", "high"]

# ---------- style ----------
sns.set_theme(style="whitegrid", font_scale=1.05)
PALETTE = {"low": "#2ecc71", "medium": "#f39c12", "high": "#e74c3c"}
COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#9b59b6", "#f39c12"]


def load_data():
    df = pd.read_csv(CSV_PATH)
    df = df.rename(columns=COLUMN_MAP)
    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = np.nan
    # Compute microbial risk labels
    risks = []
    scores = []
    for _, row in df.iterrows():
        score = 0
        for field, test_fn, weight in WHO_THRESHOLDS:
            v = row.get(field)
            if pd.notna(v) and test_fn(v):
                score += weight
        scores.append(score)
        if score >= _MAX_SCORE * 0.40:
            risks.append("high")
        elif score >= _MAX_SCORE * 0.20:
            risks.append("medium")
        else:
            risks.append("low")
    df["microbial_risk"] = risks
    df["microbial_score"] = scores
    return df


def train_potability_model(X, y):
    pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("model", RandomForestClassifier(
            n_estimators=200, max_depth=12, min_samples_split=5,
            min_samples_leaf=2, max_features="sqrt",
            class_weight="balanced", random_state=42, n_jobs=-1, oob_score=True,
        )),
    ])
    pipe.fit(X, y)
    return pipe


def train_microbial_model(X, y_labels):
    le = LabelEncoder()
    le.classes_ = np.array(RISK_LABELS)
    y = le.transform(y_labels)
    pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("model", RandomForestClassifier(
            n_estimators=200, max_depth=12, min_samples_split=5,
            min_samples_leaf=2, max_features="sqrt",
            class_weight="balanced", random_state=42, n_jobs=-1, oob_score=True,
        )),
    ])
    pipe.fit(X, y)
    return pipe, le


def save(fig, name):
    path = CHARTS_DIR / name
    fig.savefig(path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  [+] {name}")
    return str(path)


# ==========================================================================
# CHART GENERATORS
# ==========================================================================

def chart_class_distribution(df):
    """Bar charts for Potability and Microbial Risk class distributions."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    # Potability
    pot_counts = df["is_potable"].value_counts().sort_index()
    bars = axes[0].bar(
        ["Not Potable (0)", "Potable (1)"],
        [pot_counts.get(0, 0), pot_counts.get(1, 0)],
        color=[COLORS[1], COLORS[0]], edgecolor="white", linewidth=1.5,
    )
    for bar in bars:
        h = bar.get_height()
        axes[0].text(bar.get_x() + bar.get_width() / 2, h + 20,
                     f"{int(h)} ({h / len(df) * 100:.1f}%)",
                     ha="center", fontsize=10, fontweight="bold")
    axes[0].set_title("Potability Distribution", fontsize=13, fontweight="bold")
    axes[0].set_ylabel("Sample Count")

    # Microbial Risk
    risk_order = ["low", "medium", "high"]
    risk_counts = df["microbial_risk"].value_counts()
    bars2 = axes[1].bar(
        [r.capitalize() for r in risk_order],
        [risk_counts.get(r, 0) for r in risk_order],
        color=[PALETTE[r] for r in risk_order], edgecolor="white", linewidth=1.5,
    )
    for bar in bars2:
        h = bar.get_height()
        axes[1].text(bar.get_x() + bar.get_width() / 2, h + 20,
                     f"{int(h)} ({h / len(df) * 100:.1f}%)",
                     ha="center", fontsize=10, fontweight="bold")
    axes[1].set_title("Microbial Risk Distribution", fontsize=13, fontweight="bold")
    axes[1].set_ylabel("Sample Count")

    fig.suptitle("Training Data Class Distributions", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "01_class_distribution.png")


def chart_feature_importance(pot_pipe, mic_pipe, feature_names):
    """Side-by-side feature importance bar charts."""
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    for ax, pipe, title, color in [
        (axes[0], pot_pipe, "Potability Model", COLORS[0]),
        (axes[1], mic_pipe, "Microbial Risk Model", COLORS[1]),
    ]:
        imp = pipe.named_steps["model"].feature_importances_
        labels = [FEATURE_LABELS.get(f, f) for f in feature_names]
        idx = np.argsort(imp)
        ax.barh([labels[i] for i in idx], imp[idx], color=color, edgecolor="white")
        ax.set_xlabel("Importance (Gini)")
        ax.set_title(title, fontsize=13, fontweight="bold")
        for i, v in enumerate(imp[idx]):
            ax.text(v + 0.002, i, f"{v:.3f}", va="center", fontsize=9)

    fig.suptitle("Random Forest Feature Importance", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "02_feature_importance.png")


def chart_confusion_matrices(pot_pipe, mic_pipe, X, y_pot, y_mic_encoded, le):
    """OOB-based confusion matrices for both models."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Potability CM (using OOB predictions)
    pot_model = pot_pipe.named_steps["model"]
    X_transformed = pot_pipe.named_steps["scaler"].transform(
        pot_pipe.named_steps["imputer"].transform(X)
    )
    oob_pred_pot = np.argmax(pot_model.oob_decision_function_, axis=1)
    cm_pot = confusion_matrix(y_pot, oob_pred_pot)
    sns.heatmap(cm_pot, annot=True, fmt="d", cmap="Blues", ax=axes[0],
                xticklabels=["Not Potable", "Potable"],
                yticklabels=["Not Potable", "Potable"])
    axes[0].set_xlabel("Predicted")
    axes[0].set_ylabel("Actual")
    axes[0].set_title(f"Potability (OOB Acc: {pot_model.oob_score_:.3f})",
                       fontsize=12, fontweight="bold")

    # Microbial Risk CM
    mic_model = mic_pipe.named_steps["model"]
    oob_pred_mic = np.argmax(mic_model.oob_decision_function_, axis=1)
    y_mic_true = le.transform(y_mic_encoded) if isinstance(y_mic_encoded.iloc[0], str) else y_mic_encoded
    cm_mic = confusion_matrix(y_mic_true, oob_pred_mic)
    sns.heatmap(cm_mic, annot=True, fmt="d", cmap="OrRd", ax=axes[1],
                xticklabels=["Low", "Medium", "High"],
                yticklabels=["Low", "Medium", "High"])
    axes[1].set_xlabel("Predicted")
    axes[1].set_ylabel("Actual")
    axes[1].set_title(f"Microbial Risk (OOB Acc: {mic_model.oob_score_:.3f})",
                       fontsize=12, fontweight="bold")

    fig.suptitle("Confusion Matrices (Out-of-Bag Predictions)", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "03_confusion_matrices.png")


def chart_roc_curves(pot_pipe, mic_pipe, X, y_pot, y_mic_labels, le):
    """ROC curves: binary for potability, one-vs-rest for microbial risk."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Potability ROC
    pot_model = pot_pipe.named_steps["model"]
    oob_proba = pot_model.oob_decision_function_[:, 1]
    fpr, tpr, _ = roc_curve(y_pot, oob_proba)
    roc_auc = auc(fpr, tpr)
    axes[0].plot(fpr, tpr, color=COLORS[0], lw=2, label=f"AUC = {roc_auc:.3f}")
    axes[0].plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)
    axes[0].set_xlabel("False Positive Rate")
    axes[0].set_ylabel("True Positive Rate")
    axes[0].set_title("Potability ROC Curve", fontsize=12, fontweight="bold")
    axes[0].legend(loc="lower right", fontsize=11)
    axes[0].set_xlim([-0.02, 1.02])
    axes[0].set_ylim([-0.02, 1.02])

    # Microbial Risk ROC (one-vs-rest)
    mic_model = mic_pipe.named_steps["model"]
    y_mic_num = le.transform(y_mic_labels)
    y_bin = label_binarize(y_mic_num, classes=[0, 1, 2])
    oob_proba_mic = mic_model.oob_decision_function_
    risk_colors = [PALETTE["low"], PALETTE["medium"], PALETTE["high"]]
    for i, (cls_name, clr) in enumerate(zip(["Low", "Medium", "High"], risk_colors)):
        fpr_i, tpr_i, _ = roc_curve(y_bin[:, i], oob_proba_mic[:, i])
        auc_i = auc(fpr_i, tpr_i)
        axes[1].plot(fpr_i, tpr_i, color=clr, lw=2, label=f"{cls_name} (AUC={auc_i:.3f})")
    axes[1].plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)
    axes[1].set_xlabel("False Positive Rate")
    axes[1].set_ylabel("True Positive Rate")
    axes[1].set_title("Microbial Risk ROC (One-vs-Rest)", fontsize=12, fontweight="bold")
    axes[1].legend(loc="lower right", fontsize=10)
    axes[1].set_xlim([-0.02, 1.02])
    axes[1].set_ylim([-0.02, 1.02])

    fig.suptitle("ROC Curves (Out-of-Bag Probabilities)", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "04_roc_curves.png")


def chart_precision_recall(pot_pipe, mic_pipe, X, y_pot, y_mic_labels, le):
    """Precision-Recall curves."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    # Potability PR
    pot_model = pot_pipe.named_steps["model"]
    oob_proba = pot_model.oob_decision_function_[:, 1]
    prec, rec, _ = precision_recall_curve(y_pot, oob_proba)
    ap = average_precision_score(y_pot, oob_proba)
    axes[0].plot(rec, prec, color=COLORS[0], lw=2, label=f"AP = {ap:.3f}")
    axes[0].set_xlabel("Recall")
    axes[0].set_ylabel("Precision")
    axes[0].set_title("Potability PR Curve", fontsize=12, fontweight="bold")
    axes[0].legend(loc="lower left", fontsize=11)
    axes[0].set_xlim([-0.02, 1.02])
    axes[0].set_ylim([-0.02, 1.02])

    # Microbial Risk PR (one-vs-rest)
    mic_model = mic_pipe.named_steps["model"]
    y_mic_num = le.transform(y_mic_labels)
    y_bin = label_binarize(y_mic_num, classes=[0, 1, 2])
    oob_proba_mic = mic_model.oob_decision_function_
    risk_colors = [PALETTE["low"], PALETTE["medium"], PALETTE["high"]]
    for i, (cls_name, clr) in enumerate(zip(["Low", "Medium", "High"], risk_colors)):
        prec_i, rec_i, _ = precision_recall_curve(y_bin[:, i], oob_proba_mic[:, i])
        ap_i = average_precision_score(y_bin[:, i], oob_proba_mic[:, i])
        axes[1].plot(rec_i, prec_i, color=clr, lw=2, label=f"{cls_name} (AP={ap_i:.3f})")
    axes[1].set_xlabel("Recall")
    axes[1].set_ylabel("Precision")
    axes[1].set_title("Microbial Risk PR (One-vs-Rest)", fontsize=12, fontweight="bold")
    axes[1].legend(loc="lower left", fontsize=10)
    axes[1].set_xlim([-0.02, 1.02])
    axes[1].set_ylim([-0.02, 1.02])

    fig.suptitle("Precision-Recall Curves (Out-of-Bag)", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "05_precision_recall.png")


def chart_score_distribution(df):
    """Histogram of microbial risk weighted scores with risk zone overlay."""
    fig, ax = plt.subplots(figsize=(10, 5))

    scores = df["microbial_score"]
    bins = range(0, _MAX_SCORE + 2)

    # Risk zone backgrounds
    ax.axvspan(-0.5, 2.5, alpha=0.12, color=PALETTE["low"], label="Low Zone (0-2)")
    ax.axvspan(2.5, 5.5, alpha=0.12, color=PALETTE["medium"], label="Medium Zone (3-5)")
    ax.axvspan(5.5, _MAX_SCORE + 0.5, alpha=0.12, color=PALETTE["high"], label="High Zone (6-14)")

    ax.hist(scores, bins=bins, color=COLORS[3], edgecolor="white", linewidth=1.2, align="left")
    ax.axvline(x=2.8, color=PALETTE["medium"], linestyle="--", lw=2, label="Medium threshold (2.8)")
    ax.axvline(x=5.6, color=PALETTE["high"], linestyle="--", lw=2, label="High threshold (5.6)")

    ax.set_xlabel("Weighted Microbial Risk Score", fontsize=12)
    ax.set_ylabel("Number of Samples", fontsize=12)
    ax.set_title("Distribution of WHO Threshold Weighted Scores", fontsize=14, fontweight="bold")
    ax.legend(fontsize=9, loc="upper right")
    ax.set_xlim(-0.5, _MAX_SCORE + 0.5)
    ax.xaxis.set_major_locator(mticker.MultipleLocator(1))

    fig.tight_layout()
    return save(fig, "06_score_distribution.png")


def chart_correlation_heatmap(df):
    """Feature correlation heatmap."""
    fig, ax = plt.subplots(figsize=(9, 7))
    corr = df[FEATURE_COLUMNS].corr()
    labels = [FEATURE_LABELS.get(c, c) for c in FEATURE_COLUMNS]
    mask = np.triu(np.ones_like(corr, dtype=bool))
    sns.heatmap(corr, mask=mask, annot=True, fmt=".2f", cmap="RdBu_r",
                center=0, vmin=-1, vmax=1, ax=ax,
                xticklabels=labels, yticklabels=labels,
                linewidths=0.5, square=True)
    ax.set_title("Feature Correlation Matrix", fontsize=14, fontweight="bold")
    fig.tight_layout()
    return save(fig, "07_correlation_heatmap.png")


def chart_probability_distributions(pot_pipe, mic_pipe, y_pot, y_mic_labels, le):
    """Model confidence / probability distribution histograms."""
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    # Potability probability distributions by true class
    pot_model = pot_pipe.named_steps["model"]
    oob_proba_pot = pot_model.oob_decision_function_[:, 1]
    axes[0].hist(oob_proba_pot[y_pot == 0], bins=40, alpha=0.6, color=COLORS[1],
                 label="Not Potable", edgecolor="white")
    axes[0].hist(oob_proba_pot[y_pot == 1], bins=40, alpha=0.6, color=COLORS[0],
                 label="Potable", edgecolor="white")
    axes[0].axvline(x=0.58, color="black", linestyle="--", lw=2, label="Threshold (0.58)")
    axes[0].set_xlabel("P(Potable)")
    axes[0].set_ylabel("Count")
    axes[0].set_title("Potability Model Confidence", fontsize=12, fontweight="bold")
    axes[0].legend(fontsize=10)

    # Microbial Risk - max class probability distribution by true label
    mic_model = mic_pipe.named_steps["model"]
    oob_proba_mic = mic_model.oob_decision_function_
    max_proba = np.max(oob_proba_mic, axis=1)
    y_mic_num = le.transform(y_mic_labels)
    for i, (cls, clr) in enumerate(zip(["Low", "Medium", "High"],
                                        [PALETTE["low"], PALETTE["medium"], PALETTE["high"]])):
        mask = y_mic_num == i
        axes[1].hist(max_proba[mask], bins=30, alpha=0.55, color=clr,
                     label=f"{cls} (n={mask.sum()})", edgecolor="white")
    axes[1].set_xlabel("Max Class Probability (Confidence)")
    axes[1].set_ylabel("Count")
    axes[1].set_title("Microbial Risk Model Confidence", fontsize=12, fontweight="bold")
    axes[1].legend(fontsize=10)

    fig.suptitle("Model Prediction Confidence Distributions (OOB)", fontsize=15, fontweight="bold", y=1.02)
    fig.tight_layout()
    return save(fig, "08_probability_distributions.png")


def chart_calibration(pot_pipe, y_pot):
    """Calibration curve (reliability diagram) for potability model."""
    fig, ax = plt.subplots(figsize=(7, 6))

    pot_model = pot_pipe.named_steps["model"]
    oob_proba = pot_model.oob_decision_function_[:, 1]
    prob_true, prob_pred = calibration_curve(y_pot, oob_proba, n_bins=10, strategy="uniform")

    ax.plot(prob_pred, prob_true, "o-", color=COLORS[0], lw=2, markersize=8, label="Potability Model")
    ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.6, label="Perfectly Calibrated")
    ax.fill_between(prob_pred, prob_true, prob_pred, alpha=0.15, color=COLORS[0])
    ax.set_xlabel("Mean Predicted Probability", fontsize=12)
    ax.set_ylabel("Fraction of Positives", fontsize=12)
    ax.set_title("Calibration Curve (Reliability Diagram)", fontsize=14, fontweight="bold")
    ax.legend(fontsize=11, loc="lower right")
    ax.set_xlim([-0.02, 1.02])
    ax.set_ylim([-0.02, 1.02])

    fig.tight_layout()
    return save(fig, "09_calibration_curve.png")


def chart_feature_boxplots(df):
    """Box plots per feature, split by microbial risk level."""
    fig, axes = plt.subplots(3, 3, figsize=(15, 12))
    axes = axes.flatten()

    for i, col in enumerate(FEATURE_COLUMNS):
        ax = axes[i]
        data_to_plot = []
        labels_to_plot = []
        colors = []
        for risk in RISK_LABELS:
            vals = df.loc[df["microbial_risk"] == risk, col].dropna()
            data_to_plot.append(vals)
            labels_to_plot.append(risk.capitalize())
            colors.append(PALETTE[risk])

        bp = ax.boxplot(data_to_plot, labels=labels_to_plot, patch_artist=True,
                        widths=0.6, showfliers=True,
                        flierprops=dict(marker=".", markersize=3, alpha=0.3))
        for patch, c in zip(bp["boxes"], colors):
            patch.set_facecolor(c)
            patch.set_alpha(0.6)
        ax.set_title(FEATURE_LABELS.get(col, col), fontsize=11, fontweight="bold")
        ax.tick_params(axis="x", labelsize=9)

    fig.suptitle("Feature Distributions by Microbial Risk Level", fontsize=16, fontweight="bold", y=1.01)
    fig.tight_layout()
    return save(fig, "10_feature_boxplots.png")


def chart_oob_summary(pot_pipe, mic_pipe):
    """Simple bar chart showing OOB accuracy for both models."""
    fig, ax = plt.subplots(figsize=(7, 4))
    models = ["Potability\n(Binary)", "Microbial Risk\n(3-Class)"]
    scores = [pot_pipe.named_steps["model"].oob_score_,
              mic_pipe.named_steps["model"].oob_score_]
    bars = ax.bar(models, scores, color=[COLORS[0], COLORS[1]], edgecolor="white", width=0.5)
    for bar, s in zip(bars, scores):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.005,
                f"{s:.4f}\n({s * 100:.2f}%)", ha="center", fontsize=12, fontweight="bold")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("OOB Accuracy", fontsize=12)
    ax.set_title("Model Validation: Out-of-Bag Accuracy", fontsize=14, fontweight="bold")
    ax.axhline(y=0.5, color="gray", linestyle=":", lw=1, alpha=0.5, label="Random baseline (0.5)")
    ax.legend(fontsize=10)
    fig.tight_layout()
    return save(fig, "11_oob_accuracy.png")


# ==========================================================================
# MAIN
# ==========================================================================

def main():
    print("Loading data...")
    df = load_data()
    X = df[FEATURE_COLUMNS]
    y_pot = df["is_potable"].fillna(0).astype(int)
    y_mic = df["microbial_risk"]

    print("Training potability model...")
    pot_pipe = train_potability_model(X, y_pot)
    print(f"  OOB accuracy: {pot_pipe.named_steps['model'].oob_score_:.4f}")

    print("Training microbial risk model...")
    mic_pipe, le = train_microbial_model(X, y_mic)
    print(f"  OOB accuracy: {mic_pipe.named_steps['model'].oob_score_:.4f}")

    print(f"\nGenerating charts to {CHARTS_DIR}/...")
    charts = []
    charts.append(chart_class_distribution(df))
    charts.append(chart_feature_importance(pot_pipe, mic_pipe, FEATURE_COLUMNS))
    charts.append(chart_confusion_matrices(pot_pipe, mic_pipe, X, y_pot, y_mic, le))
    charts.append(chart_roc_curves(pot_pipe, mic_pipe, X, y_pot, y_mic, le))
    charts.append(chart_precision_recall(pot_pipe, mic_pipe, X, y_pot, y_mic, le))
    charts.append(chart_score_distribution(df))
    charts.append(chart_correlation_heatmap(df))
    charts.append(chart_probability_distributions(pot_pipe, mic_pipe, y_pot, y_mic, le))
    charts.append(chart_calibration(pot_pipe, y_pot))
    charts.append(chart_feature_boxplots(df))
    charts.append(chart_oob_summary(pot_pipe, mic_pipe))

    print(f"\nDone! {len(charts)} charts generated.")

    # Print classification reports for reference
    pot_model = pot_pipe.named_steps["model"]
    oob_pred_pot = np.argmax(pot_model.oob_decision_function_, axis=1)
    print("\n--- Potability Classification Report (OOB) ---")
    print(classification_report(y_pot, oob_pred_pot, target_names=["Not Potable", "Potable"]))

    mic_model = mic_pipe.named_steps["model"]
    oob_pred_mic = np.argmax(mic_model.oob_decision_function_, axis=1)
    print("--- Microbial Risk Classification Report (OOB) ---")
    print(classification_report(le.transform(y_mic), oob_pred_mic, target_names=["Low", "Medium", "High"]))


if __name__ == "__main__":
    main()
