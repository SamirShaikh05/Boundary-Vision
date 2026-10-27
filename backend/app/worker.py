from __future__ import annotations

import json
import sys
import threading
import traceback
from pathlib import Path

from .devices import available_devices
from .image_inference import process_images
from .model_cache import ModelCache
from .video_inference import process_video

PREFIX = "@@BOUNDARY_VISION@@"


def emit(message: dict) -> None:
    print(PREFIX + json.dumps(message, ensure_ascii=False), flush=True)


def handle(request: dict, cancel: threading.Event | None = None) -> None:
    action = request.get("action")
    if action == "capabilities":
        emit({"event": "capabilities", "devices": available_devices(),
              "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"})
        return
    if action == "validate_model":
        model_classes = request.get("modelClasses")
        if not isinstance(model_classes, list) or not model_classes or not all(isinstance(name, str) for name in model_classes):
            raise ValueError("Model class metadata is missing or invalid.")
        ModelCache().get(
            request.get("modelId", ""), request.get("modelPath", ""), model_classes,
            request.get("modelSha256", ""), int(request.get("modelSizeBytes", 0)),
        )
        emit({"event": "model_validated", "modelId": request.get("modelId"), "version": request.get("modelVersion")})
        return
    if action == "process_video":
        model_classes = request.get("modelClasses")
        if not isinstance(model_classes, list) or not model_classes or not all(isinstance(name, str) for name in model_classes):
            raise ValueError("Model class metadata is missing or invalid.")
        result = process_video(
            source=Path(request.get("filePath", "")).resolve(strict=True),
            output_dir=Path(request.get("outputDir", "")).resolve(strict=True),
            model_id=request.get("modelId", ""), model_path=request.get("modelPath", ""),
            model_classes=model_classes, model_sha256=request.get("modelSha256", ""),
            model_size_bytes=int(request.get("modelSizeBytes", 0)),
            ffmpeg=request.get("ffmpegPath", ""), ffprobe=request.get("ffprobePath", ""),
            confidence=float(request.get("confidence", 0.35)), device=request.get("device", "cpu"),
            inference_fps=float(request.get("inferenceFps", 2)), output_fps=float(request.get("outputFps", 30)),
            formats=request.get("formats", []), cancel=cancel or threading.Event(), emit=emit,
        )
        emit({"event": "complete", "result": result})
        return
    if action != "process_images":
        raise ValueError("Unsupported backend action.")
    paths = [Path(value).resolve(strict=True) for value in request.get("paths", [])]
    output_dir = Path(request.get("outputDir", "")).resolve()
    model_classes = request.get("modelClasses")
    if not isinstance(model_classes, list) or not model_classes or not all(isinstance(name, str) for name in model_classes):
        raise ValueError("Model class metadata is missing or invalid.")
    results = process_images(
        paths=paths, output_dir=output_dir, model_id=request.get("modelId", ""),
        model_path=request.get("modelPath", ""), model_classes=model_classes,
        model_sha256=request.get("modelSha256", ""), model_size_bytes=int(request.get("modelSizeBytes", 0)),
        confidence=float(request.get("confidence", 0.35)), device=request.get("device", "cpu"),
        batch_size=request.get("batchSize"), output_image=bool(request.get("outputImage", True)),
        formats=request.get("formats", []), emit=emit,
        cancel=cancel or threading.Event(),
    )
    emit({"event": "complete", "results": results})


def main() -> None:
    line = sys.stdin.readline()
    if not line:
        return
    try:
        request = json.loads(line)
    except Exception as exc:
        emit({"event": "error", "message": str(exc), "traceback": traceback.format_exc()})
        return
    cancel = threading.Event()
    if request.get("action") != "capabilities":
        def listen_for_cancel() -> None:
            for command_line in sys.stdin:
                try:
                    if json.loads(command_line).get("action") == "cancel":
                        cancel.set()
                        return
                except Exception:
                    continue
        threading.Thread(target=listen_for_cancel, daemon=True).start()
    try:
        handle(request, cancel)
    except Exception as exc:
        emit({"event": "error", "message": str(exc), "traceback": traceback.format_exc()})


if __name__ == "__main__":
    main()
