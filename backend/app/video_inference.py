from __future__ import annotations

import csv
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Callable, Iterator

import cv2
import numpy as np
from ultralytics import YOLO

from .annotations import write_createml, write_voc, write_yolo
from .devices import validate_device
from .model_cache import ModelCache
from .schemas import Detection


def _run_probe(ffprobe: str, source: Path) -> dict:
    command = [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"Could not inspect video metadata: {exc}") from exc
    if result.returncode:
        raise ValueError(f"FFprobe could not read this video: {result.stderr.strip() or 'unsupported or damaged media'}")
    try:
        metadata = json.loads(result.stdout)
        streams = [item for item in metadata.get("streams", []) if item.get("codec_type") == "video"]
        stream = streams[0]
        width, height = int(stream["width"]), int(stream["height"])
    except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("The selected file has no readable video stream.") from exc
    if width < 1 or height < 1 or width * height > 100_000_000:
        raise ValueError("Video dimensions are invalid or exceed the supported pixel limit.")
    duration = _number(stream.get("duration"))
    start_time = _number(stream.get("start_time")) or 0.0
    if duration is None or duration <= 0:
        duration = _number(metadata.get("format", {}).get("duration"))
        if duration is not None:
            duration = max(0.0, duration - start_time)
    if duration is None or duration <= 0 or duration > 24 * 60 * 60:
        raise ValueError("Video duration is unavailable or exceeds the 24-hour processing limit.")
    rotation = 0.0
    for side_data in stream.get("side_data_list", []):
        if "rotation" in side_data:
            rotation = _number(side_data.get("rotation")) or 0.0
    audio_starts = [_number(item.get("start_time")) for item in metadata.get("streams", []) if item.get("codec_type") == "audio"]
    audio_start = next((item for item in audio_starts if item is not None), None)
    if round(abs(rotation)) % 180 == 90:
        width, height = height, width
    return {"width": width, "height": height, "duration": duration, "start_time": start_time,
            "audio_offset": (audio_start - start_time) if audio_start is not None else 0.0,
            "has_audio": audio_start is not None}


def _number(value) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _frame_timestamps(ffprobe: str, source: Path, cancel: threading.Event) -> tuple[subprocess.Popen, Iterator[tuple[float, float | None]], deque[str]]:
    command = [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
               "frame=best_effort_timestamp_time,pkt_duration_time", "-of", "csv=p=0", str(source)]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1)
    errors: deque[str] = deque(maxlen=100)

    def collect_errors() -> None:
        assert process.stderr
        for line in process.stderr:
            errors.append(line.rstrip())

    threading.Thread(target=collect_errors, daemon=True).start()

    def iterate() -> Iterator[tuple[float, float | None]]:
        assert process.stdout
        previous = -math.inf
        for row in csv.reader(process.stdout):
            if cancel.is_set():
                raise RuntimeError("Video processing cancelled.")
            if not row or not row[0].strip() or row[0].strip() == "N/A":
                raise ValueError("FFprobe could not provide a timestamp for every decoded frame; refusing to assume a constant frame rate.")
            timestamp = _number(row[0].strip())
            duration = _number(row[1].strip()) if len(row) > 1 else None
            if timestamp is None or timestamp < previous:
                raise ValueError("Video frame timestamps are invalid or out of order.")
            previous = timestamp
            yield timestamp, duration
        code = process.wait()
        if code:
            raise RuntimeError("FFprobe failed while reading frame timestamps: " + "\n".join(errors))

    return process, iterate(), errors


def _read_exact(stream, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        part = stream.read(size - len(chunks))
        if not part:
            break
        chunks.extend(part)
    return bytes(chunks)


def _safe_stem(source: Path) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in source.stem).strip("._")
    return (cleaned or "video")[:120]


def _unique_path(directory: Path, stem: str, suffix: str) -> Path:
    candidate = directory / f"{stem}{suffix}"
    index = 1
    while candidate.exists():
        candidate = directory / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def _detections(prediction, model: YOLO) -> list[Detection]:
    items: list[Detection] = []
    if prediction.boxes is None:
        return items
    for box in prediction.boxes:
        class_id = int(box.cls.item())
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        items.append(Detection(class_id, str(model.names.get(class_id, f"Class {class_id}")),
                               float(box.conf.item()), float(x1), float(y1), float(x2), float(y2)))
    return items


def _draw(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    output = frame.copy()
    colors = [(100, 220, 120), (40, 190, 255), (255, 170, 70), (205, 105, 245), (80, 220, 230)]
    for item in detections:
        color = colors[item.class_id % len(colors)]
        x1, y1, x2, y2 = (int(round(value)) for value in (item.x1, item.y1, item.x2, item.y2))
        cv2.rectangle(output, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
        label = f"{item.class_name} {item.confidence:.0%}"
        (text_width, text_height), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        top = max(0, y1 - text_height - baseline - 7)
        cv2.rectangle(output, (x1, top), (x1 + text_width + 8, top + text_height + baseline + 7), color, -1)
        cv2.putText(output, label, (x1 + 4, top + text_height + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (15, 23, 18), 2, cv2.LINE_AA)
    return output


def process_video(
    source: Path, output_dir: Path, model_id: str, model_path: str, model_classes: list[str],
    model_sha256: str, model_size_bytes: int, ffmpeg: str, ffprobe: str,
    confidence: float, device: str, inference_fps: float, output_fps: float,
    formats: list[str], cancel: threading.Event, emit: Callable[[dict], None],
) -> dict:
    if not source.is_file():
        raise FileNotFoundError(f"Selected video does not exist: {source}")
    if not 0.01 <= confidence <= 1:
        raise ValueError("Confidence must be between 0.01 and 1.00.")
    if not 0.1 <= inference_fps <= 120 or not 1 <= output_fps <= 60:
        raise ValueError("Inference FPS must be 0.1–120 and output FPS must be 1–60.")
    if any(item not in {"yolo", "voc", "createml"} for item in formats):
        raise ValueError("One or more frame annotation formats are not supported.")
    if not Path(ffmpeg).is_file() or not Path(ffprobe).is_file():
        raise FileNotFoundError("Bundled FFmpeg tools are missing. Repair or reinstall Boundary Vision.")

    metadata = _run_probe(ffprobe, source)
    width, height, duration = metadata["width"], metadata["height"], metadata["duration"]
    audio_offset = metadata["audio_offset"]
    output_count = max(1, math.ceil(duration * output_fps - 1e-8))
    output_dir.mkdir(parents=True, exist_ok=True)
    required_space = 64 * 1024 * 1024 + int(duration * 1_000_000)
    if shutil.disk_usage(output_dir).free < required_space:
        raise OSError(f"Not enough free space for video output. Keep at least {required_space / (1024 * 1024):.0f} MB available in the output folder's drive.")
    actual_device = validate_device(device)
    model = ModelCache().get(model_id, str(Path(model_path)), model_classes, model_sha256, model_size_bytes)
    stem = _safe_stem(source)
    final_video = _unique_path(output_dir, stem, "_annotated.mp4")
    final_annotations = _unique_path(output_dir, stem, "_video_frames") if formats else None
    frame_bytes = width * height * 3
    frame_count = 0
    inferred_count = 0
    output_index = 0
    latest_frame: np.ndarray | None = None
    latest_detections: list[Detection] = []
    next_inference = 0.0
    last_progress = 0.0
    first_timestamp: float | None = None
    last_timestamp = -math.inf
    frame_duration = 0.0
    annotation_index = 0
    last_error: deque[str] = deque(maxlen=100)
    encode_errors: deque[str] = deque(maxlen=100)
    decode_process = None
    timestamp_process = None
    encode_process = None

    with tempfile.TemporaryDirectory(prefix=".bv-video-", dir=output_dir) as temporary_name:
        temporary_dir = Path(temporary_name)
        encoded_temp = temporary_dir / "annotated.mp4"
        annotation_temp = temporary_dir / "frames"
        if formats:
            annotation_temp.mkdir()
        encode_command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-s:v", f"{width}x{height}",
                          "-framerate", f"{output_fps:.6f}", "-i", "pipe:0", "-i", str(source),
                          "-map", "0:v:0", "-map", "1:a?", "-c:v", "libx264", "-preset", "fast",
                          "-crf", "22", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
                          "-c:a", "aac", "-b:a", "160k"]
        if metadata["has_audio"]:
            if audio_offset >= 0:
                audio_filter = f"asetpts=PTS-STARTPTS,adelay={round(audio_offset * 1000)}:all=1"
            else:
                audio_filter = f"atrim=start={-audio_offset:.9f},asetpts=PTS-STARTPTS"
            encode_command.extend(["-af", audio_filter])
        encode_command.extend(["-t", f"{duration:.9f}", "-movflags", "+faststart", "-f", "mp4", str(encoded_temp)])
        try:
            encode_process = subprocess.Popen(encode_command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            assert encode_process.stderr and encode_process.stdin
            threading.Thread(target=lambda: encode_errors.extend(line.decode("utf-8", "replace").rstrip() for line in iter(encode_process.stderr.readline, b"")), daemon=True).start()
            timestamp_process, timestamp_iter, timestamp_errors = _frame_timestamps(ffprobe, source, cancel)
            last_error = timestamp_errors
            decode_command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-threads", "2", "-i", str(source),
                             "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
            decode_process = subprocess.Popen(decode_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert decode_process.stdout and decode_process.stderr
            decode_errors: deque[str] = deque(maxlen=100)
            def read_decode_errors() -> None:
                for line in iter(decode_process.stderr.readline, b""):
                    decode_errors.append(line.decode("utf-8", "replace").rstrip())
            threading.Thread(target=read_decode_errors, daemon=True).start()
            stop_children = threading.Thread(target=_watch_cancel, args=(cancel, [decode_process, timestamp_process, encode_process]), daemon=True)
            stop_children.start()

            for timestamp, packet_duration in timestamp_iter:
                if cancel.is_set():
                    raise RuntimeError("Video processing cancelled.")
                raw = _read_exact(decode_process.stdout, frame_bytes)
                if len(raw) != frame_bytes:
                    if decode_process.poll() is not None:
                        raise RuntimeError("FFmpeg stopped before all timestamped frames were decoded: " + "\n".join(decode_errors))
                    raise RuntimeError("FFmpeg returned an incomplete video frame.")
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).copy()
                if first_timestamp is None:
                    first_timestamp = timestamp
                relative_time = timestamp - first_timestamp
                if relative_time < last_timestamp:
                    raise ValueError("Decoded frame timestamps moved backwards.")
                if latest_frame is not None:
                    while output_index < output_count and output_index / output_fps < relative_time - 1e-9:
                        _write_output_frame(encode_process, latest_frame, latest_detections)
                        output_index += 1
                frame_count += 1
                last_timestamp = relative_time
                frame_duration = packet_duration or frame_duration
                if relative_time + 1e-9 >= next_inference:
                    prediction = model.predict(frame, conf=confidence, device=actual_device, verbose=False)[0]
                    latest_detections = _detections(prediction, model)
                    inferred_count += 1
                    if formats:
                        annotation_index += 1
                        label_stem = f"{stem}_frame_{annotation_index:07d}_{round(relative_time * 1000):012d}ms"
                        _write_frame_annotations(annotation_temp, label_stem, source, latest_detections, width, height, formats)
                    next_inference = (math.floor(relative_time * inference_fps + 1e-8) + 1) / inference_fps
                latest_frame = frame
                while output_index < output_count and output_index / output_fps <= relative_time + 1e-9:
                    _write_output_frame(encode_process, latest_frame, latest_detections)
                    output_index += 1
                now = time.monotonic()
                if now - last_progress >= 0.2:
                    emit({"event": "video_progress", "currentTime": min(relative_time, duration), "duration": duration,
                          "percent": min(99, round(relative_time / duration * 100)), "decodedFrames": frame_count,
                          "inferredFrames": inferred_count, "outputFrames": output_index})
                    last_progress = now

            code = decode_process.wait()
            if code:
                raise RuntimeError("FFmpeg could not decode the video: " + "\n".join(decode_errors))
            if decode_process.stdout.read(1):
                raise RuntimeError("FFmpeg decoded more frames than FFprobe timestamped; refusing to write mis-timed output.")
            if frame_count == 0 or latest_frame is None:
                raise ValueError("The selected video contains no decodable frames.")
            while output_index < output_count:
                _write_output_frame(encode_process, latest_frame, latest_detections)
                output_index += 1
            encode_process.stdin.close()
            encode_code = encode_process.wait()
            if encode_code:
                raise RuntimeError("FFmpeg could not encode the result: " + "\n".join(encode_errors))
            if not encoded_temp.is_file() or encoded_temp.stat().st_size == 0:
                raise RuntimeError("FFmpeg did not create a usable output video.")
            if cancel.is_set():
                raise RuntimeError("Video processing cancelled.")
            os.replace(encoded_temp, final_video)
            if final_annotations and annotation_temp.exists():
                try:
                    os.replace(annotation_temp, final_annotations)
                except Exception:
                    final_video.unlink(missing_ok=True)
                    raise
        except Exception:
            for process in (decode_process, timestamp_process, encode_process):
                if process and process.poll() is None:
                    process.kill()
                    process.wait()
            raise

    emit({"event": "video_progress", "currentTime": duration, "duration": duration, "percent": 100,
          "decodedFrames": frame_count, "inferredFrames": inferred_count, "outputFrames": output_index})
    return {"source_path": str(source), "output_video_path": str(final_video),
            "frame_annotation_dir": str(final_annotations) if final_annotations else None,
            "duration": duration, "inference_fps": inference_fps, "output_fps": output_fps,
            "decoded_frames": frame_count, "inferred_frames": inferred_count, "output_frames": output_index,
            "model": model_id, "device": actual_device, "annotation_formats": formats}


def _watch_cancel(cancel: threading.Event, processes: list[subprocess.Popen]) -> None:
    while not cancel.wait(0.1):
        if all(process.poll() is not None for process in processes):
            return
    for process in processes:
        if process.poll() is None:
            process.terminate()


def _write_output_frame(process: subprocess.Popen, frame: np.ndarray, detections: list[Detection]) -> None:
    assert process.stdin
    try:
        process.stdin.write(_draw(frame, detections).tobytes())
    except (BrokenPipeError, OSError) as exc:
        raise RuntimeError("FFmpeg stopped while encoding video: " + str(exc)) from exc


def _write_frame_annotations(directory: Path, stem: str, source: Path, detections: list[Detection], width: int, height: int, formats: list[str]) -> None:
    image_reference = Path(f"{stem}.png")
    for format_name in formats:
        if format_name == "yolo":
            write_yolo(directory / f"{stem}.txt", detections, width, height)
        elif format_name == "voc":
            write_voc(directory / f"{stem}.xml", image_reference, detections, width, height)
        elif format_name == "createml":
            write_createml(directory / f"{stem}.json", image_reference, detections, width, height)
