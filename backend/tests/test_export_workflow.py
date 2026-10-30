from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import xml.etree.ElementTree as ET
import json
import threading

from app.annotations import annotation_filename
from app.image_inference import _copy_source_image, _resolve_candidate_stem, process_images
from app.schemas import Detection
from app.video_inference import _write_frame_annotations, process_video


class _Prediction:
    boxes = None

    def __init__(self, image: np.ndarray) -> None:
        self.image = image

    def plot(self) -> np.ndarray:
        return self.image


class _Model:
    names = {0: "ball"}

    def predict(self, images, **kwargs):
        return [_Prediction(image) for image in images]


class ExportWorkflowTests(unittest.TestCase):
    def test_format_extensions(self) -> None:
        self.assertEqual(annotation_filename("frame_0001", "yolo"), "frame_0001.txt")
        self.assertEqual(annotation_filename("frame_0001", "voc"), "frame_0001.xml")
        self.assertEqual(annotation_filename("frame_0001", "createml"), "frame_0001.json")
        with self.assertRaises(ValueError):
            annotation_filename("frame_0001", "unknown")

    def test_batch_names_are_deterministic_and_avoid_existing_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            used: set[str] = set()
            self.assertEqual(_resolve_candidate_stem(output, "photo", ".jpg", True, ["voc"], used), "photo")
            self.assertEqual(_resolve_candidate_stem(output, "photo", ".jpg", True, ["voc"], used), "photo_1")
            (output / "photo_2.xml").write_text("existing", encoding="utf-8")
            self.assertEqual(_resolve_candidate_stem(output, "photo", ".jpg", False, ["voc"], used), "photo_3")

    def test_image_inference_rejects_multiple_formats(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary) / "source.jpg"
            image.write_bytes(b"placeholder")
            with self.assertRaisesRegex(ValueError, "At most one"):
                process_images([image], Path(temporary) / "out", "model", "", [], "", 0,
                               0.5, "cpu", None, False, ["yolo", "voc"], lambda _: None)

    def test_voc_and_createml_reference_copied_source_images_for_duplicate_basenames(self) -> None:
        for format_name, extension in (("voc", ".xml"), ("createml", ".json")):
            for output_image in (True, False):
                with self.subTest(format=format_name, output_image=output_image), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    first = root / "source-a" / "photo.jpg"
                    second = root / "source-b" / "photo.jpg"
                    first.parent.mkdir()
                    second.parent.mkdir()
                    cv2.imwrite(str(first), np.full((8, 9, 3), 40, dtype=np.uint8))
                    cv2.imwrite(str(second), np.full((8, 9, 3), 180, dtype=np.uint8))
                    output = root / "output"
                    model = _Model()
                    with patch("app.image_inference.ModelCache") as cache:
                        cache.return_value.get.return_value = model
                        results = process_images([first, second], output, "model", "", ["ball"], "", 0,
                                                 0.5, "cpu", None, output_image, [format_name], lambda _: None)
                    self.assertEqual([Path(result["annotation_paths"][0]).name for result in results],
                                     [f"photo{extension}", f"photo_1{extension}"])
                    for index, result in enumerate(results):
                        image_name = "photo.jpg" if index == 0 else "photo_1.jpg"
                        copied_image = output / image_name
                        self.assertTrue(copied_image.is_file())
                        expected_source = first if index == 0 else second
                        self.assertEqual(copied_image.read_bytes(), expected_source.read_bytes())
                        preview = output / f"photo{'_1' if index else ''}_annotated.jpg"
                        self.assertEqual(preview.is_file(), output_image)
                        annotation = Path(result["annotation_paths"][0])
                        if format_name == "voc":
                            self.assertEqual(ET.parse(annotation).findtext("filename"), image_name)
                        else:
                            self.assertEqual(json.loads(annotation.read_text(encoding="utf-8"))[0]["image"], image_name)

    def test_existing_output_images_annotations_and_classes_are_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source" / "photo.jpg"
            source.parent.mkdir()
            cv2.imwrite(str(source), np.zeros((8, 9, 3), dtype=np.uint8))
            output = root / "output"
            output.mkdir()
            sentinels = {
                "photo.jpg": b"existing source asset",
                "photo.txt": b"existing annotation",
                "photo_annotated.jpg": b"existing preview",
                "classes.txt": b"unrelated class names\n",
            }
            for name, contents in sentinels.items():
                (output / name).write_bytes(contents)
            with patch("app.image_inference.ModelCache") as cache:
                cache.return_value.get.return_value = _Model()
                result = process_images([source], output, "model", "", ["ball"], "", 0,
                                        0.5, "cpu", None, True, ["yolo"], lambda _: None)[0]
            self.assertEqual(Path(result["annotation_paths"][0]).name, "photo_1.txt")
            for name, contents in sentinels.items():
                self.assertEqual((output / name).read_bytes(), contents)

    def test_source_copy_refuses_to_replace_existing_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.jpg"
            target = root / "target.jpg"
            source.write_bytes(b"source")
            target.write_bytes(b"unrelated existing data")
            with self.assertRaises(FileExistsError):
                _copy_source_image(source, target)
            self.assertEqual(target.read_bytes(), b"unrelated existing data")

    def test_video_voc_and_createml_write_the_referenced_frame_image(self) -> None:
        for format_name, extension in (("voc", ".xml"), ("createml", ".json")):
            with self.subTest(format=format_name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                stem = "clip_frame_0000001_000000000000ms"
                frame = np.full((8, 9, 3), 77, dtype=np.uint8)
                _write_frame_annotations(directory, stem, Path("clip.mp4"), frame, [], 9, 8, [format_name])
                annotation = directory / f"{stem}{extension}"
                image = directory / f"{stem}.png"
                self.assertTrue(image.is_file())
                if format_name == "voc":
                    self.assertEqual(ET.parse(annotation).findtext("filename"), image.name)
                else:
                    self.assertEqual(json.loads(annotation.read_text(encoding="utf-8"))[0]["image"], image.name)
                self.assertIsNotNone(cv2.imread(str(image)))

    def test_video_inference_rejects_multiple_formats(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "clip.mp4"
            source.write_bytes(b"placeholder")
            with self.assertRaisesRegex(ValueError, "At most one"):
                process_video(source, Path(temporary) / "out", "model", "", [], "", 0,
                              "missing-ffmpeg", "missing-ffprobe", 0.5, "cpu", 1, 1,
                              ["yolo", "voc"], threading.Event(), lambda _: None)


if __name__ == "__main__":
    unittest.main()
