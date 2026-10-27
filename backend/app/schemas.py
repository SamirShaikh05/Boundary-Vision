from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Detection:
    class_id: int
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ImageResult:
    source_path: str
    output_image_path: str | None
    annotation_paths: list[str]
    width: int
    height: int
    model: str
    device: str
    detections: list[Detection]

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["detections"] = [item.to_dict() for item in self.detections]
        return result
