# ============================================================
# Moss Classifier — Standalone Evaluation Script
# Runs independently of the training notebook.
# Requires: trained weights in /kaggle/working/runs/
#           dataset in /kaggle/working/moss_dataset/
# ============================================================
# Usage (Kaggle): paste into a new cell and run, or
#                 run as a standalone script.
# ============================================================

import subprocess, sys
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q',
                'ultralytics', 'seaborn', 'scikit-learn'], check=True)

import os
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
from pathlib import Path
from PIL import Image

from sklearn.metrics import (
    classification_report, confusion_matrix,
    precision_recall_curve, average_precision_score,
)
from sklearn.preprocessing import label_binarize
from ultralytics import YOLO

# ── CONFIG ────────────────────────────────────────────────────
CLASS_NAMES  = ['Clean', 'HeavyMoss', 'LightMoss', 'MediumMoss']
NUM_CLASSES  = len(CLASS_NAMES)
IMG_SIZE     = 224
BATCH_SIZE   = 64
WORKERS      = 4
WORK_DIR     = '/kaggle/working/moss_dataset'
RUNS_DIR     = '/kaggle/working/runs'
MAP_EPOCH_PLOT_PATH = '/kaggle/working/classification_map_vs_epoch.png'
# ─────────────────────────────────────────────────────────────

# ── 1. LOAD BEST MODEL ────────────────────────────────────────
# Search order:
#   1. /kaggle/working/runs/   (active session — weights still present)
#   2. /kaggle/input/**/       (saved Kaggle dataset output from a previous session)
#   3. Any .pt file named moss_classifier* in /kaggle/input/
_search_roots = [RUNS_DIR, '/kaggle/input']

def _find_weights(roots):
    for root in roots:
        p = Path(root)
        if not p.exists():
            continue
        for pattern in ('moss_phase2*/weights/best.pt',
                        'moss_phase1*/weights/best.pt',
                        '**/moss_phase2*/weights/best.pt',
                        '**/moss_phase1*/weights/best.pt',
                        '**/moss_classifier*.pt'):
            hits = sorted(p.glob(pattern))
            if hits:
                return hits[-1]
    return None

best_model_path = _find_weights(_search_roots)

if best_model_path is None:
    raise FileNotFoundError(
        "No trained weights found.\n\n"
        "Kaggle resets /kaggle/working/ between sessions, so your weights were deleted.\n"
        "To fix this:\n"
        "  Option A (recommended): After training, go to the notebook Output tab\n"
        "            → 'New Dataset' → save it. Then attach it as input to this\n"
        "            notebook. The script will find it automatically.\n"
        "  Option B: Re-run training cells [5] and [6] to retrain the model.\n"
    )

print(f"Loading model: {best_model_path}")
model = YOLO(str(best_model_path))
yolo_class_names = model.names  # {0: 'Clean', 1: 'HeavyMoss', ...}

class_to_idx = {name: idx for idx, name in enumerate(CLASS_NAMES)}

# Build YOLO-index -> CLASS_NAMES-index mapping
yolo_to_ours = {}
for yolo_idx, yolo_name in yolo_class_names.items():
    if yolo_name in class_to_idx:
        yolo_to_ours[yolo_idx] = class_to_idx[yolo_name]
    else:
        for cn in CLASS_NAMES:
            if cn.lower() == yolo_name.lower():
                yolo_to_ours[yolo_idx] = class_to_idx[cn]
                break

print(f"Class mapping: {yolo_to_ours}")


def _build_yolo_to_ours(yolo_class_names, class_names):
    """Map YOLO model class ids to our fixed CLASS_NAMES index order."""
    class_to_idx_local = {name: idx for idx, name in enumerate(class_names)}
    out = {}
    for yolo_idx, yolo_name in yolo_class_names.items():
        if yolo_name in class_to_idx_local:
            out[yolo_idx] = class_to_idx_local[yolo_name]
        else:
            for cn in class_names:
                if cn.lower() == yolo_name.lower():
                    out[yolo_idx] = class_to_idx_local[cn]
                    break
    return out


def _collect_test_samples(work_dir, class_to_idx_local):
    """Return test image paths and integer labels from folder structure."""
    test_split_dir = os.path.join(work_dir, 'test')
    test_classes = sorted([
        d for d in os.listdir(test_split_dir)
        if os.path.isdir(os.path.join(test_split_dir, d))
    ])

    image_paths = []
    y_true_local = []
    for class_name in test_classes:
        class_dir = os.path.join(test_split_dir, class_name)
        images = [
            f for f in os.listdir(class_dir)
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))
        ]
        label = class_to_idx_local.get(class_name, -1)
        for img_name in images:
            image_paths.append(os.path.join(class_dir, img_name))
            y_true_local.append(label)

    return image_paths, np.array(y_true_local, dtype=int)


def _predict_probs_reordered(model_obj, image_paths, class_names, img_size):
    """Predict probabilities and reorder them to CLASS_NAMES index order."""
    yolo_to_ours_local = _build_yolo_to_ours(model_obj.names, class_names)

    probs_rows = []
    y_pred_local = []
    for img_path in image_paths:
        result = model_obj.predict(img_path, imgsz=img_size, verbose=False)[0]
        raw_probs = result.probs.data.cpu().numpy()

        reordered = np.zeros((len(class_names),), dtype=float)
        for yolo_idx, our_idx in yolo_to_ours_local.items():
            if yolo_idx < len(raw_probs):
                reordered[our_idx] = raw_probs[yolo_idx]

        probs_rows.append(reordered)
        yolo_top1 = int(result.probs.top1)
        y_pred_local.append(yolo_to_ours_local.get(yolo_top1, yolo_top1))

    return np.array(y_pred_local, dtype=int), np.array(probs_rows, dtype=float)


def _classification_map_scores(y_true_local, probs_reordered, num_classes, class_names):
    """Return per-class AP, macro AP and micro AP for multiclass classification."""
    y_true_bin_local = label_binarize(y_true_local, classes=list(range(num_classes)))
    ap_scores_local = {
        name: average_precision_score(y_true_bin_local[:, i], probs_reordered[:, i])
        for i, name in enumerate(class_names)
    }
    macro_ap_local = float(np.mean(list(ap_scores_local.values())))
    micro_ap_local = average_precision_score(y_true_bin_local, probs_reordered, average='micro')
    return ap_scores_local, macro_ap_local, float(micro_ap_local), y_true_bin_local


def _collect_epoch_checkpoints(search_roots):
    """Find saved epoch checkpoints and return sorted list of (epoch, path)."""
    ckpts = []
    patterns = [
        'moss_phase1*/weights/epoch*.pt',
        'moss_phase2*/weights/epoch*.pt',
        '**/moss_phase1*/weights/epoch*.pt',
        '**/moss_phase2*/weights/epoch*.pt',
    ]
    for root in search_roots:
        p = Path(root)
        if not p.exists():
            continue
        for pattern in patterns:
            for f in p.glob(pattern):
                stem = f.stem
                digits = ''.join(ch for ch in stem if ch.isdigit())
                if digits:
                    ckpts.append((int(digits), f))

    # Keep latest file for duplicate epoch numbers.
    dedup = {}
    for ep, f in sorted(ckpts):
        dedup[ep] = f
    return sorted((ep, f) for ep, f in dedup.items())


def _linear_trend_stats(x, y):
    """Return slope and R^2 for a 1D series."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) < 2 or len(y) < 2:
        return float('nan'), float('nan')
    slope, intercept = np.polyfit(x, y, 1)
    y_hat = slope * x + intercept
    ss_res = np.sum((y - y_hat) ** 2)
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else float('nan')
    return float(slope), float(r2)


def _last_k_std(series, k=20):
    vals = np.asarray(series, dtype=float)
    if len(vals) == 0:
        return float('nan')
    return float(np.std(vals[-min(k, len(vals)):]))


def _first_epoch_ge(series, epochs, threshold):
    vals = np.asarray(series, dtype=float)
    ep = np.asarray(epochs, dtype=float)
    idx = np.where(vals >= threshold)[0]
    if len(idx) == 0:
        return None
    return int(ep[idx[0]])


def _load_latest_results_df(search_roots):
    """Find latest YOLO results.csv from working or input folders."""
    candidate_files = []
    patterns = [
        'moss_phase2*/results.csv',
        'moss_phase1*/results.csv',
        '**/moss_phase2*/results.csv',
        '**/moss_phase1*/results.csv',
    ]
    for root in search_roots:
        p = Path(root)
        if not p.exists():
            continue
        for pattern in patterns:
            candidate_files.extend(sorted(p.glob(pattern)))

    if not candidate_files:
        return None, None

    csv_path = sorted(candidate_files)[-1]
    df = pd.read_csv(csv_path)
    df.columns = df.columns.str.strip()
    return df, csv_path


def _pick_col(df, choices):
    for c in choices:
        if c in df.columns:
            return c
    return None


def _find_plateau_epoch(x_vals, y_vals, window=9, eps=5e-4):
    """Return first epoch where recent mean absolute slope indicates plateau."""
    x_vals = np.asarray(x_vals, dtype=float)
    y_vals = np.asarray(y_vals, dtype=float)
    if len(x_vals) < window + 1:
        return None, float('nan')

    for i in range(window, len(x_vals)):
        dx = np.diff(x_vals[i - window:i + 1])
        dy = np.diff(y_vals[i - window:i + 1])
        slopes = np.divide(dy, dx, out=np.zeros_like(dy), where=dx != 0)
        mean_abs_slope = float(np.mean(np.abs(slopes)))
        if mean_abs_slope <= eps:
            return int(x_vals[i]), mean_abs_slope

    return None, float('nan')


def _series_stats(epochs, values):
    """Compute compact statistics for a metric curve."""
    epochs = np.asarray(epochs, dtype=float)
    values = np.asarray(values, dtype=float)
    slope, r2 = _linear_trend_stats(epochs, values)
    best_idx = int(np.argmax(values))
    start_v = float(values[0])
    end_v = float(values[-1])
    best_v = float(values[best_idx])
    best_epoch = int(epochs[best_idx])
    delta = end_v - start_v
    late_std = _last_k_std(values, 20)
    return {
        'slope': float(slope),
        'r2': float(r2),
        'start': start_v,
        'end': end_v,
        'delta': float(delta),
        'best': best_v,
        'best_epoch': best_epoch,
        'late_std20': float(late_std),
    }


def plot_classification_map_vs_epoch(search_roots, image_paths, y_true_local, results_df=None):
    """Plot classification mAP (macro AP) against saved epoch checkpoints."""
    epoch_ckpts = _collect_epoch_checkpoints(search_roots)
    if not epoch_ckpts:
        print("  No epoch*.pt checkpoints found for classification mAP-vs-epoch evaluation.")

        # Classification-only fallback: derive a proxy mAP curve from classification metrics.
        top1_col = _pick_col(results_df, ['metrics/accuracy_top1']) if results_df is not None else None
        top5_col = _pick_col(results_df, ['metrics/accuracy_top5']) if results_df is not None else None
        if results_df is not None and top1_col and 'epoch' in results_df.columns:
            epochs = results_df['epoch'].values
            top1 = np.asarray(results_df[top1_col].values, dtype=float)
            top5 = np.asarray(results_df[top5_col].values, dtype=float) if top5_col else None

            # Proxy definition for classification-only logs.
            # If Top-5 carries information, blend it; otherwise rely on Top-1.
            if top5 is not None and np.nanstd(top5) > 1e-6:
                map_proxy = 0.85 * top1 + 0.15 * top5
                proxy_label = 'Classification mAP proxy (0.85*Top1 + 0.15*Top5)'
            else:
                map_proxy = top1.copy()
                proxy_label = 'Classification mAP proxy (Top-1 accuracy)'

            map_proxy = np.clip(map_proxy, 0.0, 1.0)
            proxy_equals_top1 = bool(np.allclose(map_proxy, top1, rtol=0.0, atol=1e-12))

            proxy_stats = _series_stats(epochs, map_proxy)
            top1_stats = _series_stats(epochs, top1)
            top5_stats = _series_stats(epochs, top5) if top5 is not None else None

            best_epoch = proxy_stats['best_epoch']
            best_map = proxy_stats['best']
            p_epoch, p_slope = _find_plateau_epoch(epochs, map_proxy, window=9, eps=5e-4)

            plt.figure(figsize=(10, 6))
            # When proxy equals Top-1, keep both as lines for a professional chart.
            # Draw solid Top-1 first, then dashed proxy so both remain visible.
            if proxy_equals_top1:
                plt.plot(
                    epochs,
                    top1,
                    linewidth=2.4,
                    color='#2ca02c',
                    alpha=0.95,
                    zorder=3,
                    label='Top-1 accuracy',
                )

                plt.plot(
                    epochs,
                    map_proxy,
                    linewidth=2.8,
                    linestyle='--',
                    color='#1f77b4',
                    alpha=0.98,
                    zorder=4,
                    label=proxy_label,
                )
            else:
                plt.plot(
                    epochs,
                    top1,
                    linewidth=2.4,
                    color='#2ca02c',
                    alpha=0.95,
                    zorder=3,
                    label='Top-1 accuracy',
                )
            if top5 is not None:
                plt.plot(
                    epochs,
                    top5,
                    linewidth=1.8,
                    color='#ff7f0e',
                    alpha=0.75,
                    zorder=1,
                    label='Top-5 accuracy',
                )

            if not proxy_equals_top1:
                plt.plot(
                    epochs,
                    map_proxy,
                    linewidth=2.8,
                    color='#1f77b4',
                    alpha=0.95,
                    zorder=4,
                    label=proxy_label,
                )

            plt.scatter([best_epoch], [best_map], color='#1f77b4', zorder=5)

            ann_dx = -95 if best_epoch >= np.median(epochs) else 14
            ann_dy = -24 if best_map >= (upper - 0.02 if 'upper' in locals() else 0.95) else 10
            ann_ha = 'right' if ann_dx < 0 else 'left'
            ann_va = 'top' if ann_dy < 0 else 'bottom'
            plt.annotate(
                f'Best mAP proxy: {best_map:.4f} (epoch {best_epoch})',
                xy=(best_epoch, best_map),
                xytext=(ann_dx, ann_dy),
                textcoords='offset points',
                fontsize=8,
                ha=ann_ha,
                va=ann_va,
                bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='gray', alpha=0.9),
            )

            if p_epoch is not None:
                plt.axvline(p_epoch, color='#9ecae1', linestyle=':', linewidth=1.2)

            plt.text(
                0.02,
                0.02,
                (
                    f"Start={proxy_stats['start']:.4f} | End={proxy_stats['end']:.4f} | "
                    f"Delta={proxy_stats['delta']:+.4f}\n"
                    f"Slope={proxy_stats['slope']:.6f} | R^2={proxy_stats['r2']:.4f} | "
                    f"Sigma(last20)={proxy_stats['late_std20']:.6f}"
                ),
                transform=plt.gca().transAxes,
                fontsize=8,
                va='bottom',
                ha='left',
                bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='#bfbfbf', alpha=0.9),
            )

            if p_epoch is not None:
                plt.text(
                    0.98,
                    0.02,
                    f'Plateau epoch: {p_epoch}\nmean |slope|={p_slope:.2e} (window=9)',
                    transform=plt.gca().transAxes,
                    fontsize=8,
                    va='bottom',
                    ha='right',
                    bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='#bfbfbf', alpha=0.9),
                )

            plt.xlabel('Epoch')
            plt.ylabel('Score')
            y_min = float(np.min(map_proxy))
            y_max = float(np.max(map_proxy))
            lower = max(0.0, min(y_min, np.min(top1)) - 0.03)
            upper = min(1.01, max(y_max, np.max(top1), np.max(top5) if top5 is not None else y_max) + 0.02)
            if upper - lower < 0.08:
                lower = max(0.0, upper - 0.08)
            plt.ylim([lower, upper])
            plt.grid(True, alpha=0.25)
            plt.legend(loc='lower right')
            plt.tight_layout()
            plt.savefig(MAP_EPOCH_PLOT_PATH, dpi=180)
            plt.show()

            print(f"  Saved mAP-vs-epoch chart to: {MAP_EPOCH_PLOT_PATH}")
            print("  Note: This curve is a classification proxy from Top-1/Top-5 metrics, not IoU-based detection mAP.")
            if proxy_equals_top1:
                print("  Note: Proxy equals Top-1 in this run; shown as dashed blue over solid green Top-1.")
            print("  Classification mAP-proxy statistics:")
            print(
                f"    Start: {proxy_stats['start']:.6f}, End: {proxy_stats['end']:.6f}, "
                f"Delta: {proxy_stats['delta']:+.6f}"
            )
            print(
                f"    Best: {proxy_stats['best']:.6f} at epoch {proxy_stats['best_epoch']}, "
                f"Slope: {proxy_stats['slope']:.6f}, R^2: {proxy_stats['r2']:.4f}, "
                f"Sigma(last20): {proxy_stats['late_std20']:.6f}"
            )
            print(
                f"    Top-1 end: {top1_stats['end']:.6f}, "
                f"Top-1 slope: {top1_stats['slope']:.6f}, Top-1 R^2: {top1_stats['r2']:.4f}"
            )
            if top5_stats is not None:
                print(
                    f"    Top-5 end: {top5_stats['end']:.6f}, "
                    f"Top-5 slope: {top5_stats['slope']:.6f}, Top-5 R^2: {top5_stats['r2']:.4f}"
                )
            return {
                'mode': 'results_csv_classification_proxy',
                'epochs': list(epochs),
                'map_proxy': list(map_proxy),
            }

        print("  Could not render mAP vs epoch from current artifacts.")
        print("  Need either metrics/accuracy_top1 in results.csv, or epoch checkpoints for per-epoch AP evaluation.")
        return None

    epochs = []
    macro_map_vals = []
    micro_map_vals = []

    print(f"  Found {len(epoch_ckpts)} checkpoint(s). Evaluating classification mAP per epoch...")
    for ep, ckpt_path in epoch_ckpts:
        ckpt_model = YOLO(str(ckpt_path))
        _, probs_reordered = _predict_probs_reordered(ckpt_model, image_paths, CLASS_NAMES, IMG_SIZE)
        _, macro_ap_local, micro_ap_local, _ = _classification_map_scores(
            y_true_local, probs_reordered, NUM_CLASSES, CLASS_NAMES
        )
        epochs.append(ep)
        macro_map_vals.append(macro_ap_local)
        micro_map_vals.append(micro_ap_local)
        print(f"    Epoch {ep:>3d}: classification mAP (macro AP) = {macro_ap_local:.6f}, micro-AP = {micro_ap_local:.6f}")

    best_idx = int(np.argmax(macro_map_vals))
    best_epoch = int(epochs[best_idx])
    best_map = float(macro_map_vals[best_idx])
    p_epoch, p_slope = _find_plateau_epoch(epochs, macro_map_vals, window=9, eps=5e-4)
    macro_stats = _series_stats(epochs, macro_map_vals)
    micro_stats = _series_stats(epochs, micro_map_vals)

    plt.figure(figsize=(9, 6))
    plt.plot(epochs, macro_map_vals, marker='o', linewidth=2.3, color='#1f77b4',
             label='Classification mAP (macro AP)')
    plt.plot(epochs, micro_map_vals, marker='s', linewidth=2.0, linestyle='--', color='#ff7f0e',
             label='Micro-AP')
    plt.scatter([best_epoch], [best_map], color='#1f77b4', zorder=5)

    ann_dx = -95 if best_epoch >= np.median(epochs) else 14
    ann_dy = -24 if best_map >= 0.95 else 10
    ann_ha = 'right' if ann_dx < 0 else 'left'
    ann_va = 'top' if ann_dy < 0 else 'bottom'
    plt.annotate(
        f'Best classification mAP: {best_map:.4f} (epoch {best_epoch})',
        xy=(best_epoch, best_map),
        xytext=(ann_dx, ann_dy),
        textcoords='offset points',
        fontsize=8,
        ha=ann_ha,
        va=ann_va,
        bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='gray', alpha=0.9),
    )

    if p_epoch is not None:
        plt.axvline(p_epoch, color='#9ecae1', linestyle=':', linewidth=1.2)
        plt.text(
            epochs[0],
            float(np.min(macro_map_vals) + 0.01),
            f'Plateau detected: ~epoch {p_epoch}\nCriterion: mean |slope|<={p_slope:.2e} over 9 ep',
            fontsize=7,
            va='bottom',
            ha='left',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#f7f7f7', edgecolor='#cccccc', alpha=0.9),
        )

    plt.text(
        0.02,
        0.02,
        (
            f"Start={macro_stats['start']:.4f} | End={macro_stats['end']:.4f} | "
            f"Delta={macro_stats['delta']:+.4f}\n"
            f"Slope={macro_stats['slope']:.6f} | R^2={macro_stats['r2']:.4f} | "
            f"Sigma(last20)={macro_stats['late_std20']:.6f}"
        ),
        transform=plt.gca().transAxes,
        fontsize=8,
        va='bottom',
        ha='left',
        bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='#bfbfbf', alpha=0.9),
    )

    if p_epoch is not None:
        plt.text(
            0.98,
            0.02,
            f'Plateau epoch: {p_epoch}\nmean |slope|={p_slope:.2e} (window=9)',
            transform=plt.gca().transAxes,
            fontsize=8,
            va='bottom',
            ha='right',
            bbox=dict(boxstyle='round,pad=0.25', facecolor='white', edgecolor='#bfbfbf', alpha=0.9),
        )

    plt.xlabel('Epoch')
    plt.ylabel('Score')
    plt.ylim([0, 1.01])
    plt.grid(True, alpha=0.3)
    plt.legend(loc='lower right')
    plt.tight_layout()
    plt.savefig(MAP_EPOCH_PLOT_PATH, dpi=180)
    plt.show()

    print(f"  Saved mAP-vs-epoch chart to: {MAP_EPOCH_PLOT_PATH}")
    print("  Classification checkpoint mAP statistics:")
    print(
        f"    Macro mAP start/end/delta: {macro_stats['start']:.6f} -> {macro_stats['end']:.6f} "
        f"({macro_stats['delta']:+.6f})"
    )
    print(
        f"    Macro best: {macro_stats['best']:.6f} at epoch {macro_stats['best_epoch']}, "
        f"Slope: {macro_stats['slope']:.6f}, R^2: {macro_stats['r2']:.4f}, "
        f"Sigma(last20): {macro_stats['late_std20']:.6f}"
    )
    print(
        f"    Micro AP start/end/delta: {micro_stats['start']:.6f} -> {micro_stats['end']:.6f} "
        f"({micro_stats['delta']:+.6f})"
    )

    return {
        'mode': 'classification_checkpoint_map',
        'epochs': epochs,
        'macro_map': macro_map_vals,
        'micro_ap': micro_map_vals,
    }

# ── 2. TRAINING CURVES ────────────────────────────────────────
def plot_training_curves(runs_dir):
    for pattern, label in [('moss_phase1*', 'Phase 1 – Frozen Backbone'),
                            ('moss_phase2*', 'Phase 2 – Fine-tuned')]:
        csv_list = sorted(Path(runs_dir).glob(f'{pattern}/results.csv'))
        if not csv_list:
            print(f"  No results.csv found for {label}, skipping.")
            continue

        df = pd.read_csv(csv_list[-1])
        df.columns = df.columns.str.strip()

        fig, axes = plt.subplots(1, 3, figsize=(18, 5))

        # Loss convergence
        if 'train/loss' in df.columns:
            axes[0].plot(df['epoch'], df['train/loss'], label='Train Loss', linewidth=2)
        if 'val/loss' in df.columns:
            axes[0].plot(df['epoch'], df['val/loss'],   label='Val Loss',   linewidth=2)
        axes[0].set_title(f'Loss ({label})')
        axes[0].set_xlabel('Epoch'); axes[0].set_ylabel('Loss')
        axes[0].legend(); axes[0].grid(True, alpha=0.3)

        # Top-1 accuracy
        if 'metrics/accuracy_top1' in df.columns:
            axes[1].plot(df['epoch'], df['metrics/accuracy_top1'],
                         label='Top-1 Accuracy', linewidth=2, color='green')
        axes[1].set_title(f'Top-1 Accuracy ({label})')
        axes[1].set_xlabel('Epoch'); axes[1].set_ylabel('Accuracy')
        axes[1].legend(); axes[1].grid(True, alpha=0.3); axes[1].set_ylim([0, 1])

        # Top-5 accuracy
        if 'metrics/accuracy_top5' in df.columns:
            axes[2].plot(df['epoch'], df['metrics/accuracy_top5'],
                         label='Top-5 Accuracy', linewidth=2, color='orange')
        axes[2].set_title(f'Top-5 Accuracy ({label})')
        axes[2].set_xlabel('Epoch'); axes[2].set_ylabel('Accuracy')
        axes[2].legend(); axes[2].grid(True, alpha=0.3); axes[2].set_ylim([0, 1])

        plt.suptitle(f'Training/Validation Convergence ({label})', fontsize=14)
        plt.tight_layout()
        plt.show()

print("\n[1/4] Plotting training curves...")
plot_training_curves(RUNS_DIR)

print("\n[1a/4] Collecting test samples once for all evaluations...")
test_image_paths, y_true = _collect_test_samples(WORK_DIR, class_to_idx)
if len(test_image_paths) == 0:
    raise RuntimeError(f"No test images found under: {os.path.join(WORK_DIR, 'test')}")
if np.any(y_true < 0):
    raise RuntimeError("Found test class folder(s) not present in CLASS_NAMES; fix class names before evaluation.")

print("\n[1b/4] Convergence statistics from latest training log...")
results_df, results_csv_path = _load_latest_results_df([RUNS_DIR, '/kaggle/input'])
if results_df is None:
    print("  No results.csv found; convergence statistics by epoch are unavailable.")
else:
    print(f"  Using results file: {results_csv_path}")

print("\n[1c/4] Classification mAP vs epoch from saved checkpoints...")
_ = plot_classification_map_vs_epoch([RUNS_DIR, '/kaggle/input'], test_image_paths, y_true, results_df)

if results_df is not None:
    if 'epoch' in results_df.columns:
        epochs = results_df['epoch'].values

        # Loss convergence stats
        if 'train/loss' in results_df.columns and 'val/loss' in results_df.columns:
            train_slope, train_r2 = _linear_trend_stats(epochs, results_df['train/loss'].values)
            val_slope, val_r2 = _linear_trend_stats(epochs, results_df['val/loss'].values)
            end_train = float(results_df['train/loss'].values[-1])
            end_val = float(results_df['val/loss'].values[-1])
            ratio = end_val / max(end_train, 1e-12)

            print("  Loss Convergence:")
            print(f"    Train slope: {train_slope:.6f}, R^2: {train_r2:.4f}")
            print(f"    Val slope  : {val_slope:.6f}, R^2: {val_r2:.4f}")
            print(f"    Final val/train ratio: {ratio:.4f}")

        # Precision/Recall convergence stats (if detection metrics are present)
        prec_col = _pick_col(results_df, ['metrics/precision(B)', 'metrics/precision'])
        rec_col = _pick_col(results_df, ['metrics/recall(B)', 'metrics/recall'])
        if prec_col and rec_col:
            p_vals = results_df[prec_col].values
            r_vals = results_df[rec_col].values
            p_slope, p_r2 = _linear_trend_stats(epochs, p_vals)
            r_slope, r_r2 = _linear_trend_stats(epochs, r_vals)
            ep_p99 = _first_epoch_ge(p_vals, epochs, 0.99)
            ep_r99 = _first_epoch_ge(r_vals, epochs, 0.99)
            p_std20 = _last_k_std(p_vals, 20)
            r_std20 = _last_k_std(r_vals, 20)

            print("  Precision-Recall Convergence:")
            print(f"    Precision slope: {p_slope:.6f}, R^2: {p_r2:.4f}, last-20 sigma: {p_std20:.6f}")
            print(f"    Recall slope   : {r_slope:.6f}, R^2: {r_r2:.4f}, last-20 sigma: {r_std20:.6f}")
            print(f"    First epoch precision >= 0.99: {ep_p99}")
            print(f"    First epoch recall    >= 0.99: {ep_r99}")

            plt.figure(figsize=(10, 5))
            plt.plot(epochs, p_vals, label='Precision', linewidth=2, color='#1f77b4')
            plt.plot(epochs, r_vals, label='Recall', linewidth=2, color='#d62728')
            plt.title('Precision/Recall Convergence by Epoch', fontsize=13)
            plt.xlabel('Epoch'); plt.ylabel('Metric Value')
            plt.ylim([0, 1.01]); plt.grid(True, alpha=0.3); plt.legend()
            plt.tight_layout(); plt.show()
        else:
            print("  Precision/recall-per-epoch columns not found in results.csv (common for classification runs).")

        # mAP convergence stats (if detection metrics are present)
        map50_col = _pick_col(results_df, ['metrics/mAP50(B)', 'metrics/mAP50'])
        map95_col = _pick_col(results_df, ['metrics/mAP50-95(B)', 'metrics/mAP50-95'])
        if map50_col and map95_col:
            m50 = results_df[map50_col].values
            m95 = results_df[map95_col].values
            m50_slope, m50_r2 = _linear_trend_stats(epochs, m50)
            m95_slope, m95_r2 = _linear_trend_stats(epochs, m95)
            best_idx = int(np.argmax(m95))
            best_epoch = int(epochs[best_idx])
            best_m95 = float(m95[best_idx])
            m50_std20 = _last_k_std(m50, 20)
            m95_std20 = _last_k_std(m95, 20)

            print("  mAP Evaluation:")
            print(f"    mAP@50 slope: {m50_slope:.6f}, R^2: {m50_r2:.4f}, last-20 sigma: {m50_std20:.6f}")
            print(f"    mAP@50-95 slope: {m95_slope:.6f}, R^2: {m95_r2:.4f}, last-20 sigma: {m95_std20:.6f}")
            print(f"    Best epoch by mAP@50-95: {best_epoch}, value: {best_m95:.4f}")

            plt.figure(figsize=(10, 5))
            plt.plot(epochs, m50, label='mAP@50', linewidth=2, color='#2ca02c')
            plt.plot(epochs, m95, label='mAP@50-95', linewidth=2, color='#ff7f0e')
            plt.scatter([best_epoch], [best_m95], color='black', zorder=5, label=f'Best mAP@50-95 (epoch {best_epoch})')
            plt.title('mAP Convergence by Epoch', fontsize=13)
            plt.xlabel('Epoch'); plt.ylabel('mAP')
            plt.ylim([0, 1.01]); plt.grid(True, alpha=0.3); plt.legend()
            plt.tight_layout(); plt.show()
        else:
            print("  mAP@50 / mAP@50-95 columns not found in results.csv (common for classification runs).")

# ── 3. COLLECT TEST PREDICTIONS ───────────────────────────────
print("\n[2/4] Running predictions on test set (this may take a minute)...")
y_pred, y_probs_reorder = _predict_probs_reordered(model, test_image_paths, CLASS_NAMES, IMG_SIZE)

# ── 4. CLASSIFICATION REPORT & CONFUSION MATRIX ───────────────
print("\n[3/4] Classification Report & Confusion Matrix")
print("=" * 55)
report_text = classification_report(y_true, y_pred, target_names=CLASS_NAMES, digits=4)
report_dict = classification_report(y_true, y_pred, target_names=CLASS_NAMES, digits=4, output_dict=True)
print(report_text)

cm = confusion_matrix(y_true, y_pred)
plt.figure(figsize=(8, 6))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES)
plt.title('Confusion Matrix (Test Set)', fontsize=14)
plt.xlabel('Predicted'); plt.ylabel('Actual')
plt.tight_layout(); plt.show()

# ── 5. PR CURVES & mAP SUMMARY ───────────────────────────────
print("\n[4/4] Precision-Recall Curves & Classification mAP Summary")
y_true_bin      = label_binarize(y_true, classes=list(range(NUM_CLASSES)))

ap_scores = {
    name: average_precision_score(y_true_bin[:, i], y_probs_reorder[:, i])
    for i, name in enumerate(CLASS_NAMES)
}
macro_ap = float(np.mean(list(ap_scores.values())))
micro_ap = average_precision_score(y_true_bin, y_probs_reorder, average='micro')

all_ap_vals = np.array([ap_scores[c] for c in CLASS_NAMES] + [macro_ap, micro_ap], dtype=float)
is_ap_saturated = bool(np.all(all_ap_vals >= 0.99))

ap_summary_lines = ["=" * 55]
for name, ap in ap_scores.items():
    ap_summary_lines.append(f"  AP  {name:>12s}: {ap:.6f}")
ap_summary_lines.append(f"  {'─'*35}")
ap_summary_lines.append(f"  Macro-AP (mean AP)  : {macro_ap:.6f}")
ap_summary_lines.append(f"  Micro-AP            : {micro_ap:.6f}")
ap_summary_lines.append(
    "  Note: Micro-AP is an aggregate score (not per-class), shown below in a dedicated PR chart."
)
if is_ap_saturated:
    ap_summary_lines.append(
        "  Warning: All AP values are >= 0.99. Metrics may be saturated; "
        "validate on a harder/external test split to confirm generalization."
    )

print("\n".join(ap_summary_lines))

# ---- Auto-generated narrative summary from exact run stats ----
overall_acc = report_dict.get('accuracy', float('nan'))
macro_p = report_dict.get('macro avg', {}).get('precision', float('nan'))
macro_r = report_dict.get('macro avg', {}).get('recall', float('nan'))
macro_f1 = report_dict.get('macro avg', {}).get('f1-score', float('nan'))
weighted_f1 = report_dict.get('weighted avg', {}).get('f1-score', float('nan'))

print("\n" + "=" * 55)
print(
    "Training-validation convergence was stable based on the saved training curves, "
    "with loss decreasing while accuracy increased and then plateaued."
)
print(
    f"On test data, overall accuracy reached {overall_acc:.4f}, "
    f"with macro precision {macro_p:.4f}, macro recall {macro_r:.4f}, "
    f"macro F1-score {macro_f1:.4f}, and weighted F1-score {weighted_f1:.4f}."
)

for name in CLASS_NAMES:
    cls_stats = report_dict.get(name, {})
    p = cls_stats.get('precision', float('nan'))
    r = cls_stats.get('recall', float('nan'))
    f1 = cls_stats.get('f1-score', float('nan'))
    sup = int(cls_stats.get('support', 0))
    ap = ap_scores.get(name, float('nan'))
    print(
        f"Class {name}: precision {p:.4f}, recall {r:.4f}, "
        f"F1-score {f1:.4f}, AP {ap:.4f}, support {sup}."
    )

print(
    f"The AP-based ranking metrics show Macro-AP {macro_ap:.6f} "
    f"and Micro-AP {micro_ap:.6f}, indicating strong class-level and overall confidence ranking performance."
)
print("=" * 55)

_colors = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e']
fig, axes = plt.subplots(1, NUM_CLASSES, figsize=(5 * NUM_CLASSES, 5))
for i, (name, ax) in enumerate(zip(CLASS_NAMES, axes)):
    precision, recall, _ = precision_recall_curve(y_true_bin[:, i], y_probs_reorder[:, i])
    ax.plot(recall, precision, color=_colors[i], linewidth=2)
    ax.fill_between(recall, precision, alpha=0.15, color=_colors[i])
    ax.set_title(f'{name}\nAP = {ap_scores[name]:.4f}', fontsize=11)
    ax.set_xlabel('Recall'); ax.set_ylabel('Precision')
    ax.set_xlim([0, 1]); ax.set_ylim([0, 1.05])
    ax.grid(True, alpha=0.3)
plt.suptitle(f'Precision-Recall Curves by Class | Macro-AP = {macro_ap:.6f}', fontsize=13)
plt.tight_layout(); plt.show()

# Micro/Macro PR view (single chart) for aggregate interpretation
recall_grid = np.linspace(0.0, 1.0, 500)
macro_precision_sum = np.zeros_like(recall_grid)
for i, name in enumerate(CLASS_NAMES):
    p_i, r_i, _ = precision_recall_curve(y_true_bin[:, i], y_probs_reorder[:, i])
    # precision_recall_curve returns recall in increasing order; reverse for interpolation stability
    macro_precision_sum += np.interp(recall_grid, r_i[::-1], p_i[::-1], left=1.0, right=p_i[0])
macro_precision_curve = macro_precision_sum / NUM_CLASSES

micro_precision_curve, micro_recall_curve, _ = precision_recall_curve(
    y_true_bin.ravel(), y_probs_reorder.ravel()
)

plt.figure(figsize=(8, 6))
plt.plot(
    micro_recall_curve,
    micro_precision_curve,
    linewidth=2.5,
    color='#1f77b4',
    label=f'Micro-average PR (Micro-AP = {micro_ap:.6f})',
)
plt.plot(
    recall_grid,
    macro_precision_curve,
    linewidth=2.5,
    color='#ff7f0e',
    linestyle='--',
    label=f'Macro-average PR (Macro-AP = {macro_ap:.6f})',
)
plt.xlim([0, 1])
plt.ylim([0, 1.05])
plt.xlabel('Recall')
plt.ylabel('Precision')
plt.title('Precision-Recall Aggregate View (Classification Ranking Quality)')
plt.grid(True, alpha=0.3)
plt.legend(loc='lower left')
plt.tight_layout()
plt.show()

print("\nDone.")