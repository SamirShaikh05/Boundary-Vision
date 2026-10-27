# LabelImg integration

LabelImg is optional. Boundary Vision does not install it or change any Python environment. Configure it from **Settings → External Tools · LabelImg**. The path is saved in the per-user `settings.json` beside other preferences and survives application updates.

> **Verification status:** The configuration and export/launch flows are present in code, but an actual LabelImg process launch and dataset round trip have not been verified.

## Supported launch methods

- Select the LabelImg Windows executable (`.exe`).
- Select a LabelImg Python launch script (`.py`) and then explicitly select the Python interpreter/environment that has its dependencies installed.
- Select an environment folder. Boundary Vision checks that folder and its immediate `Scripts`/`bin` folders for common `labelImg` executables and scripts. It can also recognize a Python environment containing the LabelImg module and launch it with `python -m labelImg`.

The folder scan is deliberately limited to the selected folder and those known subfolders; it does not search the computer. If several launchers are found, choose the one to configure. Use **Test launch** to start LabelImg and confirm that Windows can create the process. A process starting does not prove that all third-party Python dependencies or GUI plugins are healthy; failures from Python/module launch are reported when they occur.

## Open an image inference result

After image processing, choose **YOLO TXT** or **Pascal VOC XML**, then select **Open in LabelImg**. Boundary Vision asks for a parent folder and creates a new, uniquely named `boundary-vision-labelimg` dataset folder there. It copies the original source images (never modifies them), writes matching annotation filenames and a class list, then starts LabelImg with that dataset as its working directory. YOLO labels use normalized center coordinates and the model's class ID/name ordering. Pascal VOC files use the source image filename, dimensions, class names, and pixel box coordinates.

The existing annotated-preview images and CreateML JSON files are not treated as a LabelImg dataset. This action builds compatible labels from the current session's real detections, even if the original run selected only previews or CreateML. Existing files in the selected parent are preserved. LabelImg may start in Pascal VOC mode; for a YOLO dataset, switch its format using LabelImg's format button. Its documented command line accepts an image path and predefined-class file but does not expose a documented command-line switch for selecting YOLO mode. Video frame annotations are intentionally not passed to LabelImg; extract frames into a separate image dataset with matching compatible annotations before opening them there.

LabelImg opens only after a user clicks the action. It is never launched automatically. If the installation moves or is removed, update the location in Settings. The Python-environment launch mode relies on LabelImg being importable as `labelImg` in that environment.
