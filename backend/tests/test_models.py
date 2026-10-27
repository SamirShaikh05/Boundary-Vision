from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
MODELS = {
    "YOLO26n": ROOT / "models" / "cricket_yolo26n_best.pt",
    "YOLO26l": ROOT / "models" / "cricket_yolo26l_best.pt",
}


def main() -> None:
    for name, path in MODELS.items():
        print(f"\n--- {name} ---")
        if not path.is_file():
            print(f"Checkpoint not found: {path}")
            continue
        try:
            model = YOLO(str(path))
            print(f"Loaded: {path.name}")
            print(f"Classes: {model.names}")
        except Exception as exc:
            print(f"Loading failed: {exc}")


if __name__ == "__main__":
    main()
