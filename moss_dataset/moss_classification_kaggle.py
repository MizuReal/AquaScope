# ============================================================
# Moss Classification - Kaggle Training Notebook
# Classes: Clean | HeavyMoss | LightMoss | MediumMoss
# Model: YOLOv8x-cls (Ultralytics, transfer learning)
# Dataset: 4266 images from Roboflow (folder format, 224x224)
# ============================================================
# Run each section as a separate Kaggle cell (marked by # %% [cell])

# %% [1] Install & Imports
!pip install -q ultralytics seaborn scikit-learn

import os
import shutil
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import torch
from pathlib import Path
from sklearn.metrics import classification_report, confusion_matrix
from ultralytics import YOLO

print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")

# %% [2] Kaggle Dataset Setup
# ──────────────────────────────────────────────────────────────
# Fully automatic: detects whether the Kaggle input contains
# a zip file or an already-extracted folder structure, and
# handles both cases without any manual path editing.
# ──────────────────────────────────────────────────────────────
import zipfile
import glob

KAGGLE_INPUT = '/kaggle/input'
EXTRACT_DIR = '/kaggle/working/dataset'

def find_dataset_root(base_path):
    """Walk a directory tree to find the folder containing train/valid/test."""
    for root, dirs, files in os.walk(base_path):
        if 'train' in dirs and ('valid' in dirs or 'val' in dirs or 'test' in dirs):
            return root
    return None

# Step 1: Check if there are any zip files in /kaggle/input (recursive)
zip_files = glob.glob(os.path.join(KAGGLE_INPUT, '**', '*.zip'), recursive=True)

if zip_files:
    # Auto-extract the first zip found (or all of them if multiple)
    for zf_path in zip_files:
        print(f"Found zip: {zf_path}")
        if not os.path.exists(EXTRACT_DIR):
            print(f"  Extracting to {EXTRACT_DIR} ...")
            with zipfile.ZipFile(zf_path, 'r') as zf:
                zf.extractall(EXTRACT_DIR)
            print(f"  Done! Extracted {len(zf.namelist())} files.")
        else:
            print(f"  Already extracted, skipping.")

# Step 2: Search for train/valid/test structure in both locations
DATASET_DIR = find_dataset_root(EXTRACT_DIR) if os.path.exists(EXTRACT_DIR) else None
if DATASET_DIR is None:
    DATASET_DIR = find_dataset_root(KAGGLE_INPUT)
if DATASET_DIR is None:
    raise FileNotFoundError(
        "Could not find a dataset with train/valid/test folders in "
        f"{KAGGLE_INPUT} or {EXTRACT_DIR}. "
        "Make sure your Kaggle dataset contains train/, valid/ (or val/), and test/ directories."
    )

print(f"Dataset root found at: {DATASET_DIR}")

# %% [3] Configuration
CLASS_NAMES = ['Clean', 'HeavyMoss', 'LightMoss', 'MediumMoss']
NUM_CLASSES = len(CLASS_NAMES)
IMG_SIZE = 224          # YOLOv8 classification default
BATCH_SIZE = 64         # Kaggle P100/T4 can handle 64 at 224px
EPOCHS_PHASE1 = 30      # Phase 1: frozen backbone
EPOCHS_PHASE2 = 30      # Phase 2: fine-tune full model
WORKERS = 4             # Kaggle gives 4 CPU cores

TRAIN_DIR = os.path.join(DATASET_DIR, 'train')
VALID_DIR = os.path.join(DATASET_DIR, 'valid')
TEST_DIR  = os.path.join(DATASET_DIR, 'test')

# Handle 'val' vs 'valid' naming
if not os.path.exists(VALID_DIR):
    VALID_DIR = os.path.join(DATASET_DIR, 'val')

# Verify dataset structure
print("\n--- Dataset Structure ---")
for split_name, split_dir in [('Train', TRAIN_DIR), ('Valid', VALID_DIR), ('Test', TEST_DIR)]:
    if os.path.exists(split_dir):
        classes = sorted([d for d in os.listdir(split_dir)
                         if os.path.isdir(os.path.join(split_dir, d))])
        counts = {c: len(os.listdir(os.path.join(split_dir, c))) for c in classes}
        total = sum(counts.values())
        print(f"  {split_name}: {total} images -> {counts}")
    else:
        print(f"  {split_name}: NOT FOUND at {split_dir}")

# %% [4] Prepare Dataset for YOLOv8 Classification Format
# ──────────────────────────────────────────────────────────────
# YOLOv8 classify expects:
#   dataset_root/
#     train/
#       ClassName1/  (images)
#       ClassName2/  (images)
#     val/
#       ClassName1/  (images)
#       ClassName2/  (images)
#     test/
#       ... (same structure)
#
# Roboflow folder export already matches this — we just need
# to ensure the val directory is named 'val' (not 'valid').
# ──────────────────────────────────────────────────────────────

# Copy dataset to a writable working directory (Kaggle input is read-only)
WORK_DIR = '/kaggle/working/moss_dataset'

if not os.path.exists(WORK_DIR):
    print("Copying dataset to working directory...")
    shutil.copytree(DATASET_DIR, WORK_DIR)

    # Rename 'valid' -> 'val' if needed (YOLO convention)
    valid_path = os.path.join(WORK_DIR, 'valid')
    val_path = os.path.join(WORK_DIR, 'val')
    if os.path.exists(valid_path) and not os.path.exists(val_path):
        os.rename(valid_path, val_path)
        print("  Renamed 'valid' -> 'val'")
    print("  Done!")
else:
    print("Working directory already exists, skipping copy.")

print(f"\nYOLOv8 dataset root: {WORK_DIR}")
print(f"Contents: {os.listdir(WORK_DIR)}")

# %% [5] Phase 1: Train YOLOv8x-cls (Frozen Backbone)
# ──────────────────────────────────────────────────────────────
# Using yolov8x-cls (extra-large) for maximum accuracy.
# Phase 1: Train only the classification head with frozen backbone.
# ──────────────────────────────────────────────────────────────

model = YOLO('yolov8x-cls.pt')  # Extra-large model for best accuracy

# Phase 1 — Frozen backbone, warm-up the classification head
results_phase1 = model.train(
    data=WORK_DIR,
    epochs=EPOCHS_PHASE1,
    imgsz=IMG_SIZE,
    batch=BATCH_SIZE,
    workers=WORKERS,
    device=0,                        # GPU 0
    project='/kaggle/working/runs',
    name='moss_phase1',
    exist_ok=True,                   # Overwrite previous runs (no folder increment)
    pretrained=True,
    optimizer='AdamW',               # AdamW for stable convergence
    lr0=1e-3,                        # Higher LR for head-only training
    lrf=0.01,                        # Final LR = lr0 * lrf
    warmup_epochs=3,                 # Warm up learning rate
    weight_decay=0.0005,
    freeze=5,                        # Freeze first 5 layers (early backbone only)
    cos_lr=True,                     # Cosine LR schedule
    label_smoothing=0.1,             # Helps with overconfident predictions
    dropout=0.3,                     # Dropout in classifier head
    # Augmentation (built-in)
    hsv_h=0.015,                     # Hue augmentation
    hsv_s=0.7,                       # Saturation augmentation
    hsv_v=0.4,                       # Value/brightness augmentation
    degrees=15.0,                    # Rotation ±15°
    translate=0.1,                   # Translation ±10%
    scale=0.3,                       # Scale ±30%
    fliplr=0.5,                      # Horizontal flip 50%
    flipud=0.0,                      # No vertical flip (containers are upright)
    mosaic=0.0,                      # Disable mosaic (not ideal for classification)
    erasing=0.2,                     # Random erasing augmentation
    patience=10,                     # Early stopping patience
    verbose=True,
    seed=42,
)

print(f"\nPhase 1 Complete!")
print(f"  Best top-1 accuracy: {results_phase1.results_dict.get('metrics/accuracy_top1', 'N/A')}")
print(f"  Best top-5 accuracy: {results_phase1.results_dict.get('metrics/accuracy_top5', 'N/A')}")

# %% [6] Phase 2: Fine-Tune Full Model (Unfrozen)
# ──────────────────────────────────────────────────────────────
# Load the best Phase 1 checkpoint and continue training with
# the full model unfrozen at a lower learning rate.
# ──────────────────────────────────────────────────────────────

# Load best weights from Phase 1 (auto-find latest run folder)
phase1_runs = sorted(Path('/kaggle/working/runs').glob('moss_phase1*/weights/best.pt'))
if not phase1_runs:
    raise FileNotFoundError("No Phase 1 best.pt found. Run Phase 1 first.")
best_phase1 = phase1_runs[-1]  # latest run
print(f"Loading Phase 1 weights from: {best_phase1}")
model_ft = YOLO(str(best_phase1))

# Phase 2 — Full fine-tuning with lower LR
results_phase2 = model_ft.train(
    data=WORK_DIR,
    epochs=EPOCHS_PHASE2,
    imgsz=IMG_SIZE,
    batch=BATCH_SIZE,
    workers=WORKERS,
    device=0,
    project='/kaggle/working/runs',
    name='moss_phase2_finetune',
    exist_ok=True,                   # Overwrite previous runs (no folder increment)
    optimizer='AdamW',
    lr0=1e-4,                        # 10x lower LR for fine-tuning
    lrf=0.01,
    warmup_epochs=2,
    weight_decay=0.001,              # Slightly more regularization
    freeze=0,                        # Unfreeze everything
    cos_lr=True,
    label_smoothing=0.05,            # Less smoothing in phase 2
    dropout=0.2,                     # Slightly less dropout
    # Lighter augmentation for fine-tuning
    hsv_h=0.01,
    hsv_s=0.5,
    hsv_v=0.3,
    degrees=10.0,
    translate=0.08,
    scale=0.2,
    fliplr=0.5,
    flipud=0.0,
    mosaic=0.0,
    erasing=0.1,
    patience=8,
    verbose=True,
    seed=42,
)

print(f"\nPhase 2 (Fine-tune) Complete!")
print(f"  Best top-1 accuracy: {results_phase2.results_dict.get('metrics/accuracy_top1', 'N/A')}")
print(f"  Best top-5 accuracy: {results_phase2.results_dict.get('metrics/accuracy_top5', 'N/A')}")

# %% [7] Plot Training Curves (Both Phases)
def plot_yolo_results(csv_path, title_suffix=''):
    """Plot training curves from YOLOv8 results.csv."""
    import pandas as pd

    df = pd.read_csv(csv_path)
    df.columns = df.columns.str.strip()

    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    # Loss
    if 'train/loss' in df.columns:
        axes[0].plot(df['epoch'], df['train/loss'], label='Train Loss', linewidth=2)
    if 'val/loss' in df.columns:
        axes[0].plot(df['epoch'], df['val/loss'], label='Val Loss', linewidth=2)
    axes[0].set_title(f'Loss {title_suffix}')
    axes[0].set_xlabel('Epoch')
    axes[0].set_ylabel('Loss')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)

    # Top-1 Accuracy
    if 'metrics/accuracy_top1' in df.columns:
        axes[1].plot(df['epoch'], df['metrics/accuracy_top1'],
                     label='Top-1 Accuracy', linewidth=2, color='green')
        axes[1].set_title(f'Top-1 Accuracy {title_suffix}')
        axes[1].set_xlabel('Epoch')
        axes[1].set_ylabel('Accuracy')
        axes[1].legend()
        axes[1].grid(True, alpha=0.3)
        axes[1].set_ylim([0, 1])

    # Top-5 Accuracy
    if 'metrics/accuracy_top5' in df.columns:
        axes[2].plot(df['epoch'], df['metrics/accuracy_top5'],
                     label='Top-5 Accuracy', linewidth=2, color='orange')
        axes[2].set_title(f'Top-5 Accuracy {title_suffix}')
        axes[2].set_xlabel('Epoch')
        axes[2].set_ylabel('Accuracy')
        axes[2].legend()
        axes[2].grid(True, alpha=0.3)
        axes[2].set_ylim([0, 1])

    plt.tight_layout()
    plt.show()

# Plot Phase 1 (auto-find latest run)
csv_phase1_list = sorted(Path('/kaggle/working/runs').glob('moss_phase1*/results.csv'))
if csv_phase1_list:
    plot_yolo_results(str(csv_phase1_list[-1]), '(Phase 1 - Frozen Backbone)')

# Plot Phase 2 (auto-find latest run)
csv_phase2_list = sorted(Path('/kaggle/working/runs').glob('moss_phase2*/results.csv'))
if csv_phase2_list:
    plot_yolo_results(str(csv_phase2_list[-1]), '(Phase 2 - Fine-tuned)')

# %% [8] Evaluate on Test Set
# ──────────────────────────────────────────────────────────────
# Run validation on the test split for final metrics.
# ──────────────────────────────────────────────────────────────

# Auto-find best model (prefer Phase 2, fallback to Phase 1)
phase2_runs = sorted(Path('/kaggle/working/runs').glob('moss_phase2*/weights/best.pt'))
phase1_runs = sorted(Path('/kaggle/working/runs').glob('moss_phase1*/weights/best.pt'))

if phase2_runs:
    best_model_path = phase2_runs[-1]
elif phase1_runs:
    best_model_path = phase1_runs[-1]
else:
    raise FileNotFoundError("No trained model found. Run training first.")

print(f"Loading best model from: {best_model_path}")
best_model = YOLO(str(best_model_path))

# Validate on test set
test_results = best_model.val(
    data=WORK_DIR,
    split='test',
    imgsz=IMG_SIZE,
    batch=BATCH_SIZE,
    workers=WORKERS,
    device=0,
    verbose=True,
)

print(f"\n{'='*50}")
print(f"TEST SET RESULTS")
print(f"{'='*50}")
print(f"  Top-1 Accuracy: {test_results.results_dict.get('metrics/accuracy_top1', 'N/A'):.4f}")
print(f"  Top-5 Accuracy: {test_results.results_dict.get('metrics/accuracy_top5', 'N/A'):.4f}")

# %% [9] Detailed Classification Report & Confusion Matrix
# ──────────────────────────────────────────────────────────────
# Predict on every test image to build per-class metrics.
# ──────────────────────────────────────────────────────────────
from PIL import Image

test_split_dir = os.path.join(WORK_DIR, 'test')
y_true = []
y_pred = []
y_conf = []

# Determine class name mapping from folder names
test_classes = sorted([d for d in os.listdir(test_split_dir)
                       if os.path.isdir(os.path.join(test_split_dir, d))])

# Build mapping: folder name -> index (matching CLASS_NAMES order)
class_to_idx = {name: idx for idx, name in enumerate(CLASS_NAMES)}

print("\nRunning predictions on test set...")
for class_name in test_classes:
    class_dir = os.path.join(test_split_dir, class_name)
    images = [f for f in os.listdir(class_dir)
              if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))]

    for img_name in images:
        img_path = os.path.join(class_dir, img_name)
        result = best_model.predict(img_path, imgsz=IMG_SIZE, verbose=False)[0]

        pred_class_idx = result.probs.top1
        pred_conf = result.probs.top1conf.item()

        true_idx = class_to_idx.get(class_name, -1)
        y_true.append(true_idx)
        y_pred.append(pred_class_idx)
        y_conf.append(pred_conf)

y_true = np.array(y_true)
y_pred = np.array(y_pred)
y_conf = np.array(y_conf)

# Map YOLO's internal class indices to our CLASS_NAMES
# YOLO sorts class folders alphabetically; get its mapping
yolo_class_names = best_model.names  # dict {0: 'Clean', 1: 'HeavyMoss', ...}
print(f"YOLO class mapping: {yolo_class_names}")

# Classification Report
print(f"\n{'='*50}")
print("Classification Report")
print(f"{'='*50}")
# Remap y_pred from YOLO indices to our CLASS_NAMES indices
yolo_to_ours = {}
for yolo_idx, yolo_name in yolo_class_names.items():
    if yolo_name in class_to_idx:
        yolo_to_ours[yolo_idx] = class_to_idx[yolo_name]
    else:
        # Fuzzy match (case-insensitive)
        for cn in CLASS_NAMES:
            if cn.lower() == yolo_name.lower():
                yolo_to_ours[yolo_idx] = class_to_idx[cn]
                break

y_pred_mapped = np.array([yolo_to_ours.get(p, p) for p in y_pred])

print(classification_report(y_true, y_pred_mapped, target_names=CLASS_NAMES, digits=4))

# Confusion Matrix
cm = confusion_matrix(y_true, y_pred_mapped)
plt.figure(figsize=(8, 6))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES)
plt.title('Confusion Matrix - Test Set', fontsize=14)
plt.xlabel('Predicted')
plt.ylabel('Actual')
plt.tight_layout()
plt.show()

# Per-class accuracy
print("\nPer-Class Accuracy:")
for i, name in enumerate(CLASS_NAMES):
    mask = y_true == i
    if mask.sum() > 0:
        acc = (y_pred_mapped[mask] == i).sum() / mask.sum()
        print(f"  {name:>12s}: {acc:.4f} ({mask.sum()} samples)")

# %% [10] Sample Predictions (Visual Check)
import random

test_images_all = []
for class_name in test_classes:
    class_dir = os.path.join(test_split_dir, class_name)
    images = [os.path.join(class_dir, f) for f in os.listdir(class_dir)
              if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))]
    for img_path in images:
        test_images_all.append((img_path, class_name))

# Sample 8 random images
samples = random.sample(test_images_all, min(8, len(test_images_all)))

fig, axes = plt.subplots(2, 4, figsize=(16, 8))
for i, ax in enumerate(axes.flat):
    if i < len(samples):
        img_path, true_label = samples[i]
        img = Image.open(img_path).convert('RGB')

        result = best_model.predict(img_path, imgsz=IMG_SIZE, verbose=False)[0]
        pred_idx = result.probs.top1
        pred_label = yolo_class_names[pred_idx]
        confidence = result.probs.top1conf.item() * 100

        color = 'green' if true_label.lower() == pred_label.lower() else 'red'
        ax.imshow(img)
        ax.set_title(f'True: {true_label}\nPred: {pred_label} ({confidence:.1f}%)',
                     color=color, fontsize=10)
    ax.axis('off')
plt.suptitle('Sample Predictions (YOLOv8x-cls)', fontsize=14)
plt.tight_layout()
plt.show()

# %% [11] Inference Speed Benchmark
# ──────────────────────────────────────────────────────────────
# Measure prediction speed for deployment estimation.
# ──────────────────────────────────────────────────────────────
import time

benchmark_imgs = random.sample(test_images_all, min(100, len(test_images_all)))
times = []

# Warm-up (first inference is slower due to model loading)
_ = best_model.predict(benchmark_imgs[0][0], imgsz=IMG_SIZE, verbose=False)

for img_path, _ in benchmark_imgs:
    t0 = time.perf_counter()
    _ = best_model.predict(img_path, imgsz=IMG_SIZE, verbose=False)
    t1 = time.perf_counter()
    times.append((t1 - t0) * 1000)  # ms

times = np.array(times)
print(f"\n{'='*50}")
print("Inference Speed Benchmark (100 images)")
print(f"{'='*50}")
print(f"  Mean:   {times.mean():.1f} ms/image")
print(f"  Median: {np.median(times):.1f} ms/image")
print(f"  Std:    {times.std():.1f} ms")
print(f"  Min:    {times.min():.1f} ms")
print(f"  Max:    {times.max():.1f} ms")
print(f"  FPS:    {1000/times.mean():.1f}")

# %% [12] Export Models
# ──────────────────────────────────────────────────────────────
# Export to multiple formats for deployment flexibility.
# ──────────────────────────────────────────────────────────────
output_dir = Path('/kaggle/working/exported_models')
output_dir.mkdir(exist_ok=True)

# Copy best PyTorch weights
shutil.copy(str(best_model_path), str(output_dir / 'moss_classifier_yolov8x.pt'))
print(f"Saved: {output_dir / 'moss_classifier_yolov8x.pt'}")

# Export to ONNX (fast CPU/GPU inference, cross-platform)
best_model.export(format='onnx', imgsz=IMG_SIZE, simplify=True)
onnx_path = best_model_path.with_suffix('.onnx')
if onnx_path.exists():
    shutil.copy(str(onnx_path), str(output_dir / 'moss_classifier_yolov8x.onnx'))
    print(f"Saved: {output_dir / 'moss_classifier_yolov8x.onnx'}")

# Export to TorchScript (mobile / C++ deployment)
best_model.export(format='torchscript', imgsz=IMG_SIZE)
ts_path = best_model_path.with_suffix('.torchscript')
if ts_path.exists():
    shutil.copy(str(ts_path), str(output_dir / 'moss_classifier_yolov8x.torchscript'))
    print(f"Saved: {output_dir / 'moss_classifier_yolov8x.torchscript'}")

# List exported files
print(f"\nExported models in {output_dir}:")
for f in sorted(output_dir.iterdir()):
    size_mb = f.stat().st_size / (1024 * 1024)
    print(f"  {f.name:>45s}  ({size_mb:.1f} MB)")

# %% [13] Robust Prediction Function (Out-of-Domain Rejection)
# ──────────────────────────────────────────────────────────────
# Rejects images that are not valid container/moss images
# using confidence threshold + entropy gating.
# ──────────────────────────────────────────────────────────────
CONFIDENCE_THRESHOLD = 85.0    # minimum top-class confidence %
ENTROPY_THRESHOLD = 0.6        # max allowed entropy (uniform = 1.39 for 4 classes)

def compute_entropy(probs):
    """Shannon entropy of prediction distribution."""
    probs = np.clip(probs, 1e-10, 1.0)
    return -np.sum(probs * np.log(probs))

def predict_image(image_path, model, class_names=None,
                  conf_threshold=CONFIDENCE_THRESHOLD,
                  ent_threshold=ENTROPY_THRESHOLD,
                  show_plot=True):
    """
    Predict moss level on a single image with out-of-domain rejection.

    Args:
        image_path: Path to the image file.
        model: Loaded YOLO model.
        class_names: List of class names (auto-detected from model if None).
        conf_threshold: Minimum confidence % to accept prediction.
        ent_threshold: Maximum entropy to accept prediction.
        show_plot: Whether to display the image with prediction overlay.

    Returns:
        (label, confidence, is_valid) tuple.
    """
    if class_names is None:
        class_names = [model.names[i] for i in sorted(model.names.keys())]

    # Run prediction
    result = model.predict(image_path, imgsz=IMG_SIZE, verbose=False)[0]

    probs = result.probs.data.cpu().numpy()
    top_idx = result.probs.top1
    confidence = result.probs.top1conf.item() * 100
    entropy = compute_entropy(probs)

    # Rejection: low confidence OR high entropy = not a valid container image
    is_valid = confidence >= conf_threshold and entropy <= ent_threshold

    if is_valid:
        label = class_names[top_idx]
        title = f'{label} ({confidence:.1f}%)'
        color = 'green'
    else:
        label = 'Unknown'
        title = (f'NOT RECOGNIZED\n'
                 f'Top guess: {class_names[top_idx]} ({confidence:.1f}%)\n'
                 f'Entropy: {entropy:.2f} (too uncertain)')
        color = 'red'

    if show_plot:
        img = Image.open(image_path).convert('RGB')
        plt.figure(figsize=(5, 5))
        plt.imshow(img)
        plt.title(title, color=color, fontsize=11)
        plt.axis('off')
        plt.show()

    # Print all class probabilities
    print(f"  Probabilities: ", end="")
    for i, name in enumerate(class_names):
        print(f"{name}: {probs[i]*100:.1f}%", end="  ")
    print(f"\n  Entropy: {entropy:.3f} (threshold: {ent_threshold})")
    print(f"  Confidence: {confidence:.1f}% (threshold: {conf_threshold}%)")

    return label, confidence, is_valid

# Example usage (uncomment and adjust path):
# predict_image('/kaggle/working/moss_dataset/test/HeavyMoss/some_image.jpg', best_model)

# %% [14] Upload & Test Your Own Images
# ──────────────────────────────────────────────────────────────
# In Kaggle, you can upload files via the file browser or
# use the Kaggle API. Adjust paths as needed.
# ──────────────────────────────────────────────────────────────

# For Kaggle interactive upload (works in notebook mode):
# from IPython.display import display
# import ipywidgets as widgets
#
# upload_widget = widgets.FileUpload(accept='image/*', multiple=True)
# display(upload_widget)

# Or test on specific images:
test_image_dir = '/kaggle/working/test_uploads'
if os.path.exists(test_image_dir):
    test_files = [f for f in os.listdir(test_image_dir)
                  if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))]

    for filename in test_files:
        filepath = os.path.join(test_image_dir, filename)
        print(f"\n{'='*50}")
        print(f"File: {filename}")
        print(f"{'='*50}")
        label, confidence, is_valid = predict_image(filepath, best_model)
        if is_valid:
            print(f">> RESULT: {label} ({confidence:.1f}% confidence)")
        else:
            print(f">> RESULT: Image not recognized as a water container.")
            print(f"   The model is not confident this is a moss/container image.")
else:
    print(f"No upload directory found at {test_image_dir}")
    print("Create it and add images, or adjust the path above.")

# %% [15] Download Models from Kaggle
# ──────────────────────────────────────────────────────────────
# In Kaggle, outputs saved to /kaggle/working/ are available
# in the "Output" tab after the notebook finishes running.
# You can also compress and download manually:
# ──────────────────────────────────────────────────────────────

# Create a zip of all exported models for easy download
import zipfile

zip_output = '/kaggle/working/moss_models_yolov8x.zip'
with zipfile.ZipFile(zip_output, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in output_dir.iterdir():
        zf.write(str(f), f.name)

print(f"\nAll models zipped to: {zip_output}")
zip_size = os.path.getsize(zip_output) / (1024 * 1024)
print(f"Total size: {zip_size:.1f} MB")
print("\nTo download: Go to the 'Output' tab after running this notebook.")
