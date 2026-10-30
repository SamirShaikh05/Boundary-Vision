# Boundary Vision

Boundary Vision is a Windows desktop application for detecting cricket **bats, balls, and stumps** in images and videos using locally run YOLO models. The interface uses Electron, React, TypeScript, and Vite. The Windows installer includes a PyInstaller worker with its Python runtime and ML dependencies. FFmpeg and FFprobe are downloaded on demand for video processing and stored in per-user application data.

> **Current status:** The application and its main workflows are implemented in code, but end-to-end validation is incomplete. Real inference with both checkpoints, model-powered video processing, real VFR behavior, annotation correctness, cancellation cleanup, LabelImg launching/round-trip, live application updates, remote model installation, and clean-machine operation have not been verified end to end. The current installer is not ready for public distribution.

## Features

- Single-image and batch-image workflows with confidence, batch-size, and runtime-available device settings.
- Video processing with separate inference-sampling FPS and output FPS, progress reporting, cancellation, and optional audio retention.
- Annotation exports in YOLO TXT, Pascal VOC XML, and CreateML JSON. **COCO export is not supported.**
- Model Manager with a remote version registry, versioned model storage, explicit model selection, and checkpoint integrity/runtime checks.
- Optional LabelImg folder selection and user-triggered launch/export workflows for YOLO or Pascal VOC image datasets.
- Application-update code for Windows builds configured with a GitHub Releases feed. Live updates are not currently configured or verified.

Feature presence in code or a successful build is not proof that the feature works end to end. See the [engineering handover](PROJECT_CONTEXT.md) and [release validation checklist](docs/RELEASE_VALIDATION.md) for exact evidence and gaps.

## Models and availability

Boundary Vision supports both original model families:

| Model | Intended role | Original checkpoint |
|---|---|---|
| YOLO26n | Lightweight option | `models/cricket_yolo26n_best.pt` |
| YOLO26l | Larger model option | `models/cricket_yolo26l_best.pt` |

Class IDs are `0: Bat`, `1: Ball`, and `2: Stump`.

**The base Windows installer does not include either checkpoint.** Model Manager fetches the current registry from [the public raw registry](https://raw.githubusercontent.com/SamirShaikh05/Boundary-Vision/main/models/registry.json), validates it, and falls back to the bundled registry if the remote source is unavailable. The registry points to the YOLO26n and YOLO26l assets in the [`models-v1` GitHub Release](https://github.com/SamirShaikh05/Boundary-Vision/releases/tag/models-v1). Their published sizes and SHA-256 digests match the registry metadata. Model downloads are staged and verified before installation. Packaged model download and inference have not yet been verified end to end.

Model weights are distributed separately from the Git repository in the [`models-v1` GitHub Release](https://github.com/SamirShaikh05/Boundary-Vision/releases/tag/models-v1). A normal clone and Windows installer build do not require either `.pt` file, and the installer never bundles them. For local inference in a source checkout, download the desired asset from that release into `models/` using the exact filename above. For packaged-app inference, use Model Manager to install the hosted checkpoint. Both paths verify the registry's expected size and SHA-256 before use. Model Manager can also use a compatible local development copy when one is present.

To obtain local files manually, download the matching assets `cricket_yolo26n_best.pt` and/or `cricket_yolo26l_best.pt` from the release into `models/`. Verify the files against the size and SHA-256 in [`models/registry.json`](models/registry.json), for example with PowerShell `Get-FileHash models\cricket_yolo26n_best.pt -Algorithm SHA256`. The models' recorded hashes verify file identity, not current accuracy or successful inference. The packaged worker's capability check verifies startup only; it does not prove that either model loads or detects objects. Real image inference with both models is a high-priority validation task.

## Development setup (Windows PowerShell)

Use the versions recorded by the repository:

- Node.js `26.11.1` from `.nvmrc`
- Python `3.15.2` from `.python-version`

From the repository root:

```powershell
nvm install 26.11.1
nvm use 26.11.1

cd frontend
npm ci
npm run dev
```

The development desktop process expects a Python environment at `backend/.venv`. From the repository root, create it and install the developer dependencies:

```powershell
cd backend
py -3.15 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
$env:PYYAML_FORCE_LIBYAML = "0"
python -m pip install --upgrade -r requirements.txt
Remove-Item Env:PYYAML_FORCE_LIBYAML
```

Developer requirements are intentionally unpinned. The Windows release packager uses `backend/requirements-release.txt` and requires the exact Python version in `.python-version`; package versions are pinned, but wheel hashes are not. These build pins do not set a minimum Python version for packaged users: the installer includes its own Python worker and inference dependencies. Model Manager does not gate on a registry Python version field; it checks supported model format and validates a downloaded checkpoint by loading it in the actual worker before activation. Actual inference remains the final runtime compatibility check.

### For packaged users

The packaged app does not require users to install Python for image or video inference; its worker includes the Python runtime and ML dependencies. LabelImg remains separate and optional, and uses an externally installed Python environment. FFmpeg and FFprobe are downloaded only after the user requests video processing and approves setup.

The current installer is not ready for public distribution: end-to-end model download/inference validation, signing, and release requirements remain to be verified. Hosted model assets are available; the application update feed is a separate channel and is not configured in the local package build.

## Windows installer

From `frontend/`, run:

```powershell
npm run package:win
```

Packaging requires a Windows x64 host and the matching release Python build environment. FFmpeg/FFprobe are not needed to build or install Boundary Vision. See [Windows release documentation](docs/WINDOWS_RELEASE.md) before attempting a release.

The build uses `models/registry.json`; local `.pt` checkpoints are optional and are never copied into the installer. Before packaging, the script clears only the generated `frontend/build-resources/models` staging folder, writes the sanitized registry, and verifies that it is the folder's sole file. Electron Builder includes that registry file directly, so stale files elsewhere in the staging folder cannot enter the installer. If a local checkpoint is present, the packaging script checks its size and SHA-256. Missing checkpoints do not trigger downloads or block packaging. `npm run package:win` creates an installer only; it does not publish an application release or upload model assets.

The current installer is unsigned and has no configured live update feed unless a real GitHub owner and repository are supplied. Older builds created without update-feed metadata require a manual update-enabled bootstrap installation before in-app updates can work.

### Public-release blockers

Do not publish the current installer until these requirements have been addressed and verified:

1. **Code signing:** the installer and bundled executables are currently unsigned. Configure protected signing credentials, timestamp the artifacts, and verify the resulting signatures.
2. **End-to-end validation:** test both models, image and video processing (with FFmpeg/FFprobe installed for video), annotations, cancellation/cleanup, LabelImg, and installation/upgrade behavior on a clean Windows machine.
3. **Model and application updates:** the immutable model assets are published in `models-v1`; verify installation and inference from a packaged app. Configure and test the separate GitHub application update feed. The current package has no `app-update.yml`, and live app-update installation has not been tested.

See [Windows packaging and signing](docs/WINDOWS_RELEASE.md), [application updates](docs/APP_UPDATES.md), [model distribution](docs/MODEL_DISTRIBUTION.md), and the [release validation checklist](docs/RELEASE_VALIDATION.md).

## Documentation

- [Project handover and prioritized roadmap](PROJECT_CONTEXT.md)
- [Model distribution and version management](docs/MODEL_DISTRIBUTION.md)
- [Application updates and GitHub Releases](docs/APP_UPDATES.md)
- [LabelImg setup and supported launch methods](docs/LABELIMG.md)
- [Release validation checklist](docs/RELEASE_VALIDATION.md)
- [Windows packaging and signing](docs/WINDOWS_RELEASE.md)
