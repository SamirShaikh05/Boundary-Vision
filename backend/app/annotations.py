from __future__ import annotations

import json
import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .schemas import Detection

ANNOTATION_EXTENSIONS = {"yolo": ".txt", "voc": ".xml", "createml": ".json"}


def annotation_filename(stem: str, format_name: str) -> str:
    try:
        extension = ANNOTATION_EXTENSIONS[format_name]
    except KeyError as exc:
        raise ValueError(f"Unsupported annotation format: {format_name}") from exc
    return f"{stem}{extension}"


def _atomic_bytes(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=".bv-", suffix=path.suffix, dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(contents)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def write_yolo(path: Path, detections: list[Detection], width: int, height: int) -> None:
    lines = []
    for item in detections:
        center_x = ((item.x1 + item.x2) / 2) / width
        center_y = ((item.y1 + item.y2) / 2) / height
        box_width = (item.x2 - item.x1) / width
        box_height = (item.y2 - item.y1) / height
        lines.append(f"{item.class_id} {center_x:.6f} {center_y:.6f} {box_width:.6f} {box_height:.6f}")
    _atomic_bytes(path, ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8"))


def write_classes_txt(path: Path, class_names: list[str]) -> None:
    _atomic_bytes(path, ("\n".join(class_names) + ("\n" if class_names else "")).encode("utf-8"))


def write_voc(path: Path, image_path: Path, detections: list[Detection], width: int, height: int) -> None:
    root = ET.Element("annotation")
    ET.SubElement(root, "filename").text = image_path.name
    size = ET.SubElement(root, "size")
    ET.SubElement(size, "width").text = str(width)
    ET.SubElement(size, "height").text = str(height)
    ET.SubElement(size, "depth").text = "3"
    for item in detections:
        obj = ET.SubElement(root, "object")
        ET.SubElement(obj, "name").text = item.class_name
        ET.SubElement(obj, "confidence").text = f"{item.confidence:.6f}"
        box = ET.SubElement(obj, "bndbox")
        ET.SubElement(box, "xmin").text = str(max(1, int(item.x1) + 1))
        ET.SubElement(box, "ymin").text = str(max(1, int(item.y1) + 1))
        ET.SubElement(box, "xmax").text = str(min(width, int(item.x2)))
        ET.SubElement(box, "ymax").text = str(min(height, int(item.y2)))
    ET.indent(root, space="  ")
    _atomic_bytes(path, ET.tostring(root, encoding="utf-8", xml_declaration=True))


def write_createml(path: Path, image_path: Path, detections: list[Detection], width: int, height: int) -> None:
    annotations = []
    for item in detections:
        annotations.append({
            "label": item.class_name,
            "coordinates": {
                "x": round((item.x1 + item.x2) / 2, 3),
                "y": round((item.y1 + item.y2) / 2, 3),
                "width": round(item.x2 - item.x1, 3),
                "height": round(item.y2 - item.y1, 3),
            },
        })
    data = [{"image": image_path.name, "width": width, "height": height, "annotations": annotations}]
    _atomic_bytes(path, json.dumps(data, indent=2).encode("utf-8"))
