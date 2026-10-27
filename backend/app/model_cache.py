from pathlib import Path
from hashlib import sha256

from ultralytics import YOLO

class ModelCache:
    """Cache models by registry ID and resolved checkpoint path."""

    def __init__(self) -> None:
        self._models: dict[tuple[str, str], YOLO] = {}

    def get(
        self, model_id: str, checkpoint_path: str, expected_classes: list[str],
        expected_sha256: str, expected_size_bytes: int,
    ) -> YOLO:
        path = Path(checkpoint_path).resolve(strict=True)
        if not path.is_file():
            raise FileNotFoundError(f"Model checkpoint is missing: {path}")
        if path.stat().st_size != expected_size_bytes:
            raise ValueError(f"Model '{model_id}' has an unexpected file size.")
        digest = sha256()
        with path.open("rb") as checkpoint:
            for chunk in iter(lambda: checkpoint.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected_sha256:
            raise ValueError(f"Model '{model_id}' failed SHA-256 verification.")
        key = (model_id, str(path))
        if key not in self._models:
            model = YOLO(str(path))
            names = model.names
            actual_classes = [str(names[index]) for index in range(len(names))]
            if actual_classes != expected_classes:
                raise ValueError(
                    f"Model '{model_id}' class mapping does not match its registry entry. "
                    f"Expected {expected_classes}, loaded {actual_classes}."
                )
            self._models[key] = model
        return self._models[key]

    def release(self, model_id: str) -> None:
        for key in [key for key in self._models if key[0] == model_id]:
            del self._models[key]
