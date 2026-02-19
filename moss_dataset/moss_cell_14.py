# %% Quick Test — Create folder, upload, predict (no retraining)
import os
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from PIL import Image
from ultralytics import YOLO
import ipywidgets as widgets
from IPython.display import display, HTML

# ── 1. Create the upload folder ──
test_image_dir = '/kaggle/working/test_uploads'
os.makedirs(test_image_dir, exist_ok=True)
print(f"Upload folder ready: {test_image_dir}")
print("Use the upload button below, then click 'Save uploaded images'.\n")

display(HTML(f"<b>Upload images for testing</b><br>Target folder: {test_image_dir}"))

uploader = widgets.FileUpload(
    accept='.jpg,.jpeg,.png,.bmp,.webp',
    multiple=True,
    description='Choose image(s)'
)
save_btn = widgets.Button(description='Save uploaded images', button_style='success')
out = widgets.Output()

def iter_uploaded_files(value):
    if isinstance(value, dict):
        for filename, meta in value.items():
            yield filename, meta['content']
    elif isinstance(value, (list, tuple)):
        for meta in value:
            yield meta['name'], meta['content']

def on_save_clicked(_):
    with out:
        out.clear_output()
        if not uploader.value:
            print('No files selected yet.')
            return

        saved = 0
        for filename, content in iter_uploaded_files(uploader.value):
            Path(test_image_dir, filename).write_bytes(content)
            saved += 1

        print(f"Saved {saved} file(s) to {test_image_dir}")
        print('Now re-run this cell to run predictions on uploaded images.')

save_btn.on_click(on_save_clicked)
display(uploader, save_btn, out)

# ── 2. Load trained model (no retraining) ──
for pattern in ['moss_phase2*/weights/best.pt', 'moss_phase1*/weights/best.pt']:
    hits = sorted(Path('/kaggle/working/runs').glob(pattern))
    if hits:
        best_model = YOLO(str(hits[-1]))
        print(f"Loaded model: {hits[-1]}")
        break
else:
    raise FileNotFoundError("No trained model found in /kaggle/working/runs")

CLASS_NAMES = [best_model.names[i] for i in sorted(best_model.names.keys())]
IMG_SIZE = 224
CONF_THRESH = 85.0
ENT_THRESH  = 0.6

# ── 3. Predict on every image in the folder ──
test_files = [f for f in os.listdir(test_image_dir)
              if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))]

if not test_files:
    print("⚠ No images found yet.")
    print("  → Click 'Choose image(s)' and pick your files")
    print("  → Click 'Save uploaded images'")
    print("  → Re-run this cell")
else:
    for filename in test_files:
        filepath = os.path.join(test_image_dir, filename)
        result = best_model.predict(filepath, imgsz=IMG_SIZE, verbose=False)[0]

        probs = result.probs.data.cpu().numpy()
        top_idx = result.probs.top1
        conf = result.probs.top1conf.item() * 100
        entropy = float(-np.sum(np.clip(probs, 1e-10, 1) * np.log(np.clip(probs, 1e-10, 1))))
        is_valid = conf >= CONF_THRESH and entropy <= ENT_THRESH

        # Display
        img = Image.open(filepath).convert('RGB')
        plt.figure(figsize=(6, 6))
        plt.imshow(img)
        if is_valid:
            plt.title(f"✓ {CLASS_NAMES[top_idx]}  ({conf:.1f}%)", color='green', fontsize=14)
        else:
            plt.title(f"✕ NOT RECOGNIZED\nTop guess: {CLASS_NAMES[top_idx]} ({conf:.1f}%)\n"
                      f"Entropy: {entropy:.2f}", color='red', fontsize=11)
        plt.axis('off')
        plt.show()

        print(f"{'─'*40}")
        print(f"  File       : {filename}")
        print(f"  Predicted  : {CLASS_NAMES[top_idx] if is_valid else 'Unknown'}")
        print(f"  Confidence : {conf:.1f}%  (threshold: {CONF_THRESH}%)")
        print(f"  Entropy    : {entropy:.3f}  (threshold: {ENT_THRESH})")
        print(f"  Valid      : {is_valid}")
        for i, name in enumerate(CLASS_NAMES):
            bar = '█' * int(probs[i] * 40)
            print(f"  {name:>12s}: {probs[i]*100:5.1f}%  {bar}")
        print()