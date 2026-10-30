# Boundary Vision

## 1. Project Introduction

### AI-powered Cricket Object Detection

Boundary Vision is a Windows desktop application that finds **Bat**, **Ball**, and **Stump** in cricket images and videos. It runs YOLO object-detection models locally, so your media is processed on your computer rather than sent to a cloud inference service.

The app is for cricket coaches, analysts, researchers, and anyone who wants to review cricket footage or prepare labeled images. The packaged application is designed for normal desktop use; you do not need programming knowledge to install or use it.

**[Download Boundary Vision for Windows x64](https://github.com/SamirShaikh05/Boundary-Vision/releases/latest)** · [All releases](https://github.com/SamirShaikh05/Boundary-Vision/releases)

The current public application release is **0.1.0**. Its installer is unsigned. Model installation, real model inference, video processing, and application updates have not all been verified end to end on a clean Windows computer. See the [release validation checklist](docs/RELEASE_VALIDATION.md) for the remaining checks.

## 2. Application Screenshots

There are no application screenshots in the repository yet. The checked-in PNG is the application icon, not a screenshot. Screenshots should be captured from the running application before being added here; planned captures are listed in the final report for this README update.

## 3. Features and Capabilities

| Feature | What you can do |
|---|---|
| Image detection | Inspect one image, see detected objects and confidence scores, and save an image with bounding boxes. |
| Batch processing | Select multiple image files and process them in one run with progress and cancellation controls. |
| Video detection | Create an annotated MP4, choose model-sampling and output frame rates separately, and view the result in the app. Video work requires FFmpeg and FFprobe, which the app can download when needed. |
| Model Manager | Install, verify, select, update, and remove eligible managed model versions. |
| Annotation export | Write labels as YOLO TXT, Pascal VOC XML, or CreateML JSON. |
| LabelImg integration | Copy completed image results into a dataset with YOLO or Pascal VOC labels, then open it in the external LabelImg editor. |
| Application updates | Check the configured GitHub Releases feed, download an update when available, and choose when to restart and install it. |

Boundary Vision includes two model options. **YOLO26n** is the lightweight choice intended for lower resource use. **YOLO26l** is the larger model for users who want to try that model and have more capable hardware. No performance or accuracy benchmarks are provided here.

The app offers the devices reported by its inference runtime. CPU is available; the packaged release worker is CPU-only, so a GPU option may not appear in the installed app. A GPU may be offered in a development environment if that environment supports it.

## 4. System Requirements

### For normal users

- A 64-bit Windows computer. The current installer targets Windows x64; a minimum Windows version and minimum CPU, memory, or disk specification are not published.
- An internet connection to download model files, retrieve application updates, and download the optional FFmpeg/FFprobe tools. If the remote model registry is unavailable, the app can use its bundled registry.
- Python, Node.js, and FFmpeg do not need to be installed by the user for image inference. The packaged app includes its inference worker; video tools are downloaded by the app after you request video processing.
- The installer is unsigned. Windows security settings or organization policy may warn about or block it.

After a model is installed, inference runs locally. Processing speed depends on the computer and model; no minimum performance level is guaranteed.

### For developers

The documented Windows development and packaging environment uses Node.js `26.11.1` from [`.nvmrc`](.nvmrc) and Python `3.15.2` from [`.python-version`](.python-version). The release build also uses the pinned packages in [`backend/requirements-release.txt`](backend/requirements-release.txt). See [Developer Information](#15-developer-information) for setup steps.

## 5. Download and Installation

1. Open the [official Boundary Vision Releases page](https://github.com/SamirShaikh05/Boundary-Vision/releases/latest).
2. In the latest release's **Assets** section, download `Boundary-Vision-Setup-0.1.0-x64.exe`. For a later release, use the installer filename shown on that release page. The current installer is for Windows x64.
3. Open the downloaded installer and follow the setup prompts. Choose an installation location if asked.
4. Finish installation and launch Boundary Vision from the Start menu or desktop shortcut.

The current installer is **unsigned**, so Windows may show a SmartScreen or other security warning. Before proceeding, confirm that the download came from the official repository and that the filename matches the release. If you cannot verify the source, cancel. If Windows offers a **More info** / **Run anyway** option and you decide to proceed after checking the source, you can choose it. Some Windows security features and work/school policies block unsigned apps; do not disable security protections to install Boundary Vision. [Microsoft explains that Smart App Control may block unsigned apps](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

## 6. First Launch and Model Installation

A detection model is the file that lets Boundary Vision recognize the supported objects. The app needs an installed and selected model before it can run image or video inference.

On a new installation with no selected model, Boundary Vision opens **Model Manager**. Model files are downloaded and verified by the app; users normally do not need to handle `.pt` files themselves.

1. In **Model Manager**, review the YOLO26n and YOLO26l cards and choose a version to install. The card shows its version, classes, size, and current status.
2. Choose **Install** on the available version. If a local development copy is detected, the action may instead say **Copy … to app storage**.
3. Watch the progress stages: downloading, checksum verification, runtime validation, and activation.
4. After installation, choose **Use …** to select the version for inference. Installing a version does not automatically select it.
5. Return to **Images** or **Video** to run detection.

Before activation, the app checks the file size and SHA-256 checksum, then asks its inference worker to load the model and validate its classes. A failed download or validation is rejected and does not replace the previously selected model. The version card shows the error; retry by choosing its install action again. These checks establish file integrity and runtime loading, not detection accuracy.

Model Manager fetches a remote registry and falls back to the bundled registry if the remote registry cannot be reached or validated. Downloading model files still requires an internet connection. The checkpoint assets are hosted in the [`models-v1` release](https://github.com/SamirShaikh05/Boundary-Vision/releases/tag/models-v1). Packaged hosted installation and real inference have not yet been verified end to end; if an installation fails, keep using the existing selected model and retry later.

To manage installed models:

- Choose **Check for model updates** to refresh the registry. Available updates are shown on model cards and counted on the Models navigation icon.
- Choose **Update …** for one model or **Update all** for all listed model updates. Review each version's progress and error state. Retry a failed update using its install/update action.
- Choose **Use …** to change which installed version inference uses. Newly installed versions are not selected automatically.
- Choose **Remove …** to remove an eligible managed copy. The selected version and a model currently being used cannot be removed. Original development checkpoint files are not managed copies and are not removed by this action.

## 7. Image Detection Tutorial

1. Choose **Images** in the left navigation rail.
2. Choose **Browse images** and select an image from any folder on your computer. Supported file types include JPG/JPEG, PNG, BMP, WebP, TIF, and TIFF.
3. Under **Inference Settings**, select an installed **Detection Model**. Use **Manage Models** if you need to install one.
4. Adjust **Confidence Threshold** if needed. Confidence is the model's score for a proposed object. A higher threshold accepts fewer, more confident detections; a lower threshold may show more uncertain detections. The control ranges from 5% to 95%.
5. Choose a **Processing Device** from the available options. The packaged worker is CPU-only; use a GPU only if a GPU device is actually listed by the running environment.
6. Choose a folder with **Save Results To**. You can select an existing writable folder anywhere on your computer.
7. Keep **Annotated Images** enabled to save a copy with boxes drawn around detected objects. Optionally select one annotation format under **Output Formats**.
8. Choose **Run Detection**. Results appear below the controls. Each result shows the source name, model, detected class labels, and confidence scores. Select an image preview to enlarge it.

A **bounding box** is a rectangle around a detected object. Its class label says what the model thinks the object is; the confidence score shows how strongly the model made that prediction. If no object passes the selected confidence threshold, the result reports no objects above threshold.

Annotated images are saved in the chosen output folder using the source name with `_annotated` added. If you also select an annotation format, a label file with the matching base name is saved there. Existing output files are preserved; Boundary Vision chooses another name if a generated filename already exists.

## 8. Batch Image Processing Tutorial

1. In **Images**, choose **Browse images** and select multiple files in the file picker. The picker selects files, not entire folders. Choose **Add more images** to select files from another location.
2. Remove an individual file with its remove button or choose **Clear all**.
3. Select a model, confidence threshold, processing device, output folder, and output formats as described in the image tutorial.
4. Choose **Batch Size**: **Automatic (1)**, **1 image**, **2 images**, or **4 images**. Batch size is how many images are passed through processing together. Larger batches can use more memory; Automatic currently uses one image.
5. Choose **Run Detection**. The status line and result area show completed images and progress.
6. Choose **Cancel** to request that the current run stop.

The app saves each completed image's outputs in the selected output folder. If an input image cannot be read or processing stops, Boundary Vision shows an error; it does not provide a separate list of skipped images. Outputs already completed are kept.

## 9. Video Detection Tutorial

1. Choose **Video** in the left navigation rail.
2. Choose **Browse video** and select one supported file. The picker supports common formats including MP4, MOV, MKV, AVI, WebM, M4V, MPG/MPEG, TS, and 3GP.
3. Select an installed model and choose a writable output folder.
4. Set **Inference Sampling FPS** and **Output Video FPS**. Inference FPS controls how often the model evaluates a frame; output FPS controls the playback frame rate of the rendered video. For example, at 2 inference FPS the model evaluates about two frames per second, while a 30 output FPS video renders 30 frames per second and reuses the latest detections between evaluations.
5. The **Annotated Video** is always produced. Optionally choose one frame annotation format: YOLO TXT, Pascal VOC XML, or CreateML JSON. Frame labels are generated for inference samples; this is not a LabelImg image dataset.
6. Choose **Process Video**. Progress displays source time, decoded frames, rendered frames, and inference frames.
7. Choose **Cancel** to request cancellation.
8. When processing finishes, use the playback controls in **Processed Video Results** to view the video.
9. Find the annotated MP4 and any frame annotation folder in the selected output directory. Source audio is retained when available.

Video processing requires FFmpeg and FFprobe. Boundary Vision does not bundle them and has no separate video-tools settings screen. On the first video job, the app asks whether to **Download tools**. If you approve, it downloads the pinned FFmpeg Essentials archive, verifies its SHA-256, safely extracts and checks the required executables, and stores them in app-managed per-user data for later video jobs. If setup fails, choose **Retry** or **Cancel**. You can retry setup by starting video processing again. Without valid FFmpeg and FFprobe tools, video processing cannot continue; image detection is unaffected.

## 10. Annotation Export Formats

Annotations record the detected object's class and location so compatible tools can read or edit the results. Under **Output Formats**, select at most one annotation format and choose the output directory with **Save Results To**. For images, you can save annotated images, annotation files, or both. For video, the annotated MP4 is always generated and frame annotations are optional.

| Format | What it contains | File details |
|---|---|---|
| **YOLO TXT** | One line per object with a class ID and normalized center X/Y, width, and height. Normalized coordinates are relative to the image dimensions. | A `.txt` file with the same base filename as the image. Image and label names must correspond when preparing a dataset. Image exports also include `classes.txt`. |
| **Pascal VOC XML** | XML elements with object class names, image dimensions, and pixel-coordinate bounding boxes. | An `.xml` file with the image's base name and filename reference. |
| **CreateML JSON** | JSON with the image name and dimensions, class labels, and pixel-coordinate box values. | A `.json` file with the image's base name. |

The current class IDs are `0: Bat`, `1: Ball`, and `2: Stump`. Review exported annotations before using them as training data. The app does not support COCO export.

## 11. LabelImg Integration

[LabelImg](https://github.com/HumanSignal/labelImg) is an external image annotation editor. You might use it to review or correct Boundary Vision's image detections. It is not installed or bundled by Boundary Vision and may need to be installed separately.

### Configure and test LabelImg

1. Obtain LabelImg separately and locate the folder containing `labelImg.py`.
2. In Boundary Vision, choose **Settings & About** from the left navigation rail.
3. Under **External Tools · LabelImg**, choose **Select LabelImg Folder** and select the folder containing the script. The app remembers this folder.
4. Boundary Vision checks for that folder's dedicated `.venv` Python interpreter and verifies that `PyQt5` and `lxml` can be imported. It does not use the Boundary Vision inference environment.
5. If the environment is missing, and Python 3 is installed, create the environment in the LabelImg folder and install the required packages:

   ```powershell
   py -3 -m venv .venv
   .\.venv\Scripts\python -m pip install PyQt5 lxml
   ```

6. Select the folder again if needed. When its status says it is ready, choose **Open LabelImg** to test the launch. This opens LabelImg without a dataset; choose image and annotation folders in LabelImg itself.

### Open detection results in LabelImg

1. Configure LabelImg as described above and run image detection. The export uses completed image results from the current Boundary Vision session.
2. In the results section, choose **YOLO TXT** or **Pascal VOC XML** under **Export format for LabelImg**.
3. Choose **Open in LabelImg**.

Boundary Vision creates a new `boundary-vision-labelimg` folder inside the selected output folder. If that folder already exists, the app adds a number rather than replacing it. The dataset contains copies of the original images, matching label files, and `classes.txt`; LabelImg opens the new dataset. The export supports YOLO and Pascal VOC, not CreateML or video-frame labels. If LabelImg does not open, check the selected folder and its `.venv` dependencies, then try again.

## 12. Application Updates and Model Updates

These are separate update workflows:

| Update type | What changes | Where to manage it |
|---|---|---|
| Application update | The Boundary Vision program. | **Settings & About** and the app update banner. |
| Model update | A YOLO checkpoint used for detection. | **Model Manager**. |

### Application updates

Boundary Vision checks its configured GitHub Releases feed shortly after startup and periodically. You can also choose **Check for updates** in **Settings & About**. A build without update-feed configuration reports that updates are not configured.

When an update is available, the app displays a banner and an update status. Choose **Download update** to start the download; progress and errors are shown. The app does not download or install an update without your action. When the download is ready, choose **Restart and install** in the banner or **Restart to install** in Settings. Choose **Later** to defer installation from the banner. Restart is blocked while inference or a model task is active.

If an update check or download fails, read the displayed error and choose **Check for updates** again when online. You can also download the installer from [the latest GitHub release](https://github.com/SamirShaikh05/Boundary-Vision/releases/latest). The packaged in-app update installation has not been validated end to end.

### Model updates

In Model Manager, choose **Check for model updates**. Install a model update with **Update …**, or choose **Update all** for the listed models. The app shows transfer and verification progress. Size, SHA-256, and runtime class checks must pass before activation; failed updates can be retried and do not replace the selected model. Choose **Use …** separately to select an installed version.

## 13. Troubleshooting and FAQs

### Windows warns about or blocks the installer

The installer is unsigned. Confirm that the download came from the official [Boundary Vision release page](https://github.com/SamirShaikh05/Boundary-Vision/releases/latest) and matches the listed asset name. Cancel if you cannot verify the source. Some security settings and managed devices block unsigned apps; do not disable protections to proceed.

### The application does not launch, or the worker reports an error

The packaged worker includes Python, so users do not need to install Python for Boundary Vision inference. Read any error shown by the app. If the app remains unusable, download the installer again from the official release and reinstall. If the problem continues, report the exact error and Windows version in [GitHub Issues](https://github.com/SamirShaikh05/Boundary-Vision/issues). Clean-machine startup remains a release-validation task.

### No model is installed, or a model download fails

Open **Models**, connect to the internet, and choose **Install** for YOLO26n or YOLO26l. If the remote registry is unavailable, the app tries its bundled registry; downloading the model file still needs a connection. Read the version error and retry its install action. Keep using the previous selected model if the new one fails.

### Model verification fails

The downloaded file may not match its registry size or SHA-256, or the worker may not be able to load and validate it. Retry later in case the transfer was interrupted. If the error persists, keep the previous model selected and report the model version and error. Do not bypass the checks.

### CPU inference is slow, or no GPU is listed

The packaged release worker is CPU-only. You can try the lightweight YOLO26n option and use a smaller image batch if memory is constrained; this does not guarantee a particular speed. GPU devices appear only when the running inference environment reports them as available.

### Batch processing takes a long time or stops

Progress is shown as images complete. Choose **Automatic (1)** or **1 image** if memory is constrained. Use **Cancel** to request that processing stop. If a file cannot be read or processing fails, the app shows an error rather than a separate skipped-image report. Completed output files are kept.

### Video processing reports missing FFmpeg or FFprobe

Start a video job and approve **Download tools** when prompted. If setup fails, choose **Retry**. If you cancel setup, start video processing later to try again. Image detection does not require these tools.

### LabelImg does not open

In **Settings & About**, confirm that the selected folder contains `labelImg.py` and its `.venv` can import `PyQt5` and `lxml`. If the folder moved, select the new location. Follow any error shown by Boundary Vision and retry.

### An application update is unavailable or fails

In **Settings & About**, check whether the feed is configured and choose **Check for updates** when online. Retry after reading any error. Builds without update-feed metadata cannot use in-app updating; use the [latest release page](https://github.com/SamirShaikh05/Boundary-Vision/releases/latest) to get the installer. In-app update installation has not been validated end to end.

## 14. Contributing to Boundary Vision

Contributions are welcome from developers, students, researchers, and future interns. There are two broad areas:

- **Application contributions:** frontend/UI, Electron desktop features, the Python inference worker, image/video workflows, annotation exports, tests, and documentation.
- **AI model contributions:** cricket dataset preparation and annotation, YOLO training and evaluation, model improvements, and compatible model proposals. Include dataset permissions and evaluation details with model proposals; do not commit large `.pt` checkpoint files.

Basic contribution workflow:

1. [Fork the repository](https://github.com/SamirShaikh05/Boundary-Vision/fork) and clone your fork.
2. Create a focused branch for your change.
3. Make the change and run relevant tests.
4. Open a [Pull Request](https://github.com/SamirShaikh05/Boundary-Vision/pulls) and respond to review feedback.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup, testing, coding, and model proposal guidance. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) and [MIT License](LICENSE). Report problems or suggest features in [GitHub Issues](https://github.com/SamirShaikh05/Boundary-Vision/issues).

## 15. Developer Information

### Technology and architecture

- **Desktop and interface:** Electron, React, TypeScript, and Vite.
- **Inference:** a local Python worker using Ultralytics, PyTorch, and OpenCV.
- **Video:** the worker processes video with FFmpeg and FFprobe supplied through app-managed per-user storage.
- **Models:** a versioned registry describes supported formats, classes, download URLs, sizes, and hashes. Managed model files are stored in the user's app data.

Electron starts the worker and passes it local file paths and inference settings. Inference does not require a cloud service. The packaged app includes its Python worker; development runs `backend/.venv`.

### Repository map

```text
backend/       Python inference worker, image/video processing, and tests
docs/          Model, update, LabelImg, packaging, and release guidance
frontend/      Electron main process, React UI, scripts, and tests
models/        Model registry and hosting template; weights are distributed separately
```

### Prerequisites and development setup

Use Node.js `26.11.1` from [`.nvmrc`](.nvmrc) and Python `3.15.2` from [`.python-version`](.python-version). In PowerShell from the repository root:

```powershell
nvm install 26.11.1
nvm use 26.11.1
cd backend
py -3.15 -m venv .venv
.\.venv\Scripts\Activate.ps1
$env:PYYAML_FORCE_LIBYAML = "0"
python -m pip install --upgrade -r requirements.txt
Remove-Item Env:PYYAML_FORCE_LIBYAML
cd ..\frontend
npm ci
npm run dev
```

The Electron development app starts the Python worker when needed; there is no separate worker service to launch. The worker uses `backend/.venv`.

### Tests, build, and packaging

Run frontend commands from `frontend/`:

```powershell
npm run test:workflow
npm run test:updates
npm run test:staging
npm run build
```

Run backend tests from `backend/` after activating its virtual environment:

```powershell
python -m pytest tests -q
```

`npm run package:win` creates a local Windows installer and requires the pinned release dependencies in `backend/.venv`; it does not publish a release. `npm run release:win` is the GitHub publishing workflow and requires release configuration and credentials. It creates/publishes a draft release; do not run it unless you intend to publish release assets. The installer includes the app, Python worker, and model registry; it excludes `.pt` weights and FFmpeg/FFprobe. See [Windows release documentation](docs/WINDOWS_RELEASE.md), [application update documentation](docs/APP_UPDATES.md), and the [release validation checklist](docs/RELEASE_VALIDATION.md).

## 16. Author and Copyright

### Author

Boundary Vision is an original project created and maintained by **Samir Jamil Shaikh**.

Copyright (c) 2026 Samir Jamil Shaikh.

Licensed under the [MIT License](LICENSE).

[GitHub Profile](https://github.com/SamirShaikh05)
