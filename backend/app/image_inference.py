from __future__ import annotations

from pathlib import Path
import os
import tempfile
import threading

import cv2
import numpy as np

from .annotations import write_createml, write_voc, write_yolo
from .devices import validate_device
from .model_cache import ModelCache
from .paths import SUPPORTED_IMAGE_SUFFIXES
from .schemas import Detection, ImageResult


def _read_image(path: Path) -> np.ndarray:
    try:
        image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    except OSError as exc:
        raise ValueError(f"Could not read image '{path.name}': {exc}") from exc
    if image is None:
        raise ValueError(f"Unsupported or corrupted image: {path.name}")
    return image


def _safe_output_path(directory: Path, stem: str, suffix: str) -> Path:
    candidate = directory / f"{stem}{suffix}"
    index = 1
    while candidate.exists():
        candidate = directory / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def _write_image_atomically(path: Path, image: np.ndarray) -> None:
    extension = path.suffix or ".png"
    success, encoded = cv2.imencode(extension, image)
    if not success:
        raise OSError(f"Could not encode annotated image: {path.name}")
    handle, temp_name = tempfile.mkstemp(prefix=".bv-", suffix=extension, dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(encoded.tobytes())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def process_images(
    paths: list[Path], output_dir: Path, model_id: str, model_path: str,
    model_classes: list[str], model_sha256: str, model_size_bytes: int, confidence: float,
    device: str, batch_size: int | None, output_image: bool, formats: list[str], emit,
    cancel: threading.Event | None = None,
) -> list[dict]:
    if not paths:
        raise ValueError("Select at least one image.")
    if not 0.01 <= confidence <= 1:
        raise ValueError("Confidence must be between 0.01 and 1.00.")
    if batch_size is not None and batch_size not in {1, 2, 4}:
        raise ValueError("Batch size must be Auto, 1, 2, or 4.")
    valid_formats = {"yolo", "voc", "createml"}
    if any(item not in valid_formats for item in formats):
        raise ValueError("One or more annotation formats are not supported.")
    if not output_image and not formats:
        raise ValueError("Select annotated images, annotation exports, or both.")
    for path in paths:
        if path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES or not path.is_file():
            raise ValueError(f"Not a supported image file: {path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    actual_device = validate_device(device)
    model = ModelCache().get(model_id, str(Path(model_path)), model_classes, model_sha256, model_size_bytes)
    results: list[dict] = []
    group_size = batch_size or 1
    total = len(paths)
    for offset in range(0, total, group_size):
        if cancel and cancel.is_set():
            raise RuntimeError("Image processing cancelled. Finished outputs were kept.")
        group = paths[offset:offset + group_size]
        images = [_read_image(path) for path in group]
        try:
            predictions = model.predict(images, conf=confidence, device=actual_device, batch=len(group), verbose=False)
        except RuntimeError as exc:
            message = str(exc).lower()
            memory_failure = "memory" in message or "cuda" in message
            if len(group) == 1 or not memory_failure:
                raise
            predictions = []
            for image in images:
                predictions.extend(model.predict(image, conf=confidence, device=actual_device, batch=1, verbose=False))
        for path, image, prediction in zip(group, images, predictions):
            height, width = image.shape[:2]
            detections: list[Detection] = []
            if prediction.boxes is not None:
                for box in prediction.boxes:
                    class_id = int(box.cls.item())
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    detections.append(Detection(
                        class_id, str(model.names.get(class_id, f"Class {class_id}")),
                        float(box.conf.item()), float(x1), float(y1), float(x2), float(y2),
                    ))
            out_image_path = None
            annotation_paths: list[str] = []
            if output_image:
                out_image_path = _safe_output_path(output_dir, path.stem, "_annotated" + path.suffix.lower())
                _write_image_atomically(out_image_path, prediction.plot())
            for fmt in formats:
                suffix = {"yolo": ".txt", "voc": ".xml", "createml": ".json"}[fmt]
                target = _safe_output_path(output_dir, path.stem, f"_{fmt}" + suffix)
                if fmt == "yolo":
                    write_yolo(target, detections, width, height)
                elif fmt == "voc":
                    write_voc(target, path, detections, width, height)
                else:
                    write_createml(target, path, detections, width, height)
                annotation_paths.append(str(target))
            result = ImageResult(str(path), str(out_image_path) if out_image_path else None,
                                 annotation_paths, width, height, model_id, actual_device, detections).to_dict()
            results.append(result)
            emit({"event": "progress", "completed": len(results), "total": total,
                  "current": path.name, "result": result})
    return results
