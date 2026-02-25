from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "backend"
DST = ROOT / "hugging-face"

EXCLUDED_DIRS = {
    "__pycache__",
    ".git",
}

EXCLUDED_RELATIVE_PREFIXES = (
    Path("debug_output") / "captures",
)

EXCLUDED_FILES = {
    Path(".env"),
}


def is_excluded(path: Path, source_root: Path) -> bool:
    rel = path.relative_to(source_root)

    if rel in EXCLUDED_FILES:
        return True

    for prefix in EXCLUDED_RELATIVE_PREFIXES:
        try:
            rel.relative_to(prefix)
            return True
        except ValueError:
            pass

    return any(part in EXCLUDED_DIRS for part in rel.parts)


def copy_file(src_file: Path, source_root: Path, target_root: Path) -> None:
    rel = src_file.relative_to(source_root)

    if rel == Path("Dockerfile.hf"):
        dst_file = target_root / "Dockerfile"
    else:
        dst_file = target_root / rel

    dst_file.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_file, dst_file)


def sync_backend_to_hf() -> None:
    if not SRC.exists():
        raise FileNotFoundError(f"Source folder not found: {SRC}")
    if not DST.exists():
        raise FileNotFoundError(f"Target folder not found: {DST}")

    copied = 0

    for src_file in SRC.rglob("*"):
        if not src_file.is_file():
            continue
        if is_excluded(src_file, SRC):
            continue

        copy_file(src_file, SRC, DST)
        copied += 1

    print(f"Synced {copied} files from '{SRC.name}' to '{DST.name}'.")


if __name__ == "__main__":
    sync_backend_to_hf()
