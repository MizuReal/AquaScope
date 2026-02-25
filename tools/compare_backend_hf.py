import hashlib
import json
import os

LEFT = "backend"
RIGHT = "hugging-face"


def list_files(root: str) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {"__pycache__", ".git"}]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace("\\", "/")
            mapping[rel] = full
    return mapping


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


left = list_files(LEFT)
right = list_files(RIGHT)

shared = sorted(set(left) & set(right))
only_left = sorted(set(left) - set(right))
only_right = sorted(set(right) - set(left))

differing = []
for rel in shared:
    if sha256(left[rel]) != sha256(right[rel]):
        differing.append(rel)

print(
    json.dumps(
        {
            "sharedCount": len(shared),
            "differingCount": len(differing),
            "onlyBackendCount": len(only_left),
            "onlyHuggingFaceCount": len(only_right),
            "differing": differing,
            "onlyBackend": only_left,
            "onlyHuggingFace": only_right,
        },
        indent=2,
    )
)
