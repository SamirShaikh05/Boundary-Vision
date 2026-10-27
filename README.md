# Boundary Vision

Boundary Vision is a Windows desktop application for detecting cricket **bats, balls, and stumps** in images and videos using locally run YOLO models. The interface uses Electron, React, TypeScript, and Vite. A local Python worker performs inference; FFmpeg and FFprobe support video processing.

> **Current status:** The application and its main workflows are implemented in code, but end-to-end validation is incomplete. Real inference with both checkpoints, model-powered video processing, real VFR behavior, annotation correctness, cancellation cleanup, LabelImg launching/round-trip, live application updates, remote model installation, and clean-machine operation have not been verified end to end. The current installer is not ready for public distribution.

## Features

- Single-image and batch-image workflows with confidence, batch-size, and runtime-available device settings.
- Video processing with separate inference-sampling FPS and output FPS, progress reporting, cancellation, and optional audio retention.
- Annotation exports in YOLO TXT, Pascal VOC XML, and CreateML JSON. **COCO export is not supported.**
- Model Manager with versioned model storage, explicit model selection, and checkpoint integrity/runtime checks.
- Optional LabelImg configuration and user-triggered export/open workflows for YOLO or Pascal VOC image datasets.
- Application-update code for Windows builds configured with a GitHub Releases feed. Live updates are not currently configured or verified.

Feature presence in code or a successful build is not proof that the feature works end to end. See the [engineering handover](PROJECT_CONTEXT.md) and [release validation checklist](docs/RELEASE_VALIDATION.md) for exact evidence and gaps.

## Models and availability

Boundary Vision supports both original model families:

| Model | Intended role | Original checkpoint |
|---|---|---|
| YOLO26n | Lightweight option | `models/cricket_yolo26n_best.pt` |
| YOLO26l | Larger model option | `models/cricket_yolo26l_best.pt` |

Class IDs are `0: Bat`, `1: Ball`, and `2: Stump`.

**The base Windows installer does not include either checkpoint.** The original checkpoints are retained in the development repository and must remain unchanged. The current model registry has size/hash metadata but no hosted download URLs. Consequently, a packaged installation cannot download a model until a real HTTPS host and immutable model assets are configured. The development-only local model-install workflow is distinct from the packaged user's experience.

The models' recorded hashes verify file identity, not current accuracy or successful inference. The packaged worker's capability check verifies startup only; it does not prove that either model loads or detects objects. Real image inference with both models is a high-priority validation task.

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

Developer requirements are intentionally unpinned. The Windows release packager uses `backend/requirements-release.txt` and requires the exact Python version in `.python-version`; package versions are pinned, but wheel hashes are not.

### For packaged users

The packaged application is designed to include its Python worker/runtime, so users should not need to install Python separately. This does **not** mean the current installer is ready for general use: model availability, real inference, clean-machine installation, and release requirements remain to be verified.

## Windows installer

From `frontend/`, run:

```powershell
npm run package:win
```

Packaging requires a Windows x64 host, the matching release Python environment, and FFmpeg/FFprobe on `PATH` with the required upstream license and provenance files. See [Windows release documentation](docs/WINDOWS_RELEASE.md) before attempting a release.

The current installer is unsigned and has no configured live update feed unless a real GitHub owner and repository are supplied. Older builds created without update-feed metadata require a manual update-enabled bootstrap installation before in-app updates can work.

### Public-release blockers

Do not publish the current installer until these requirements have been addressed and verified:

1. **FFmpeg source and licensing:** the bundled Gyan FFmpeg full build includes GPLv3-or-later components, including `libx264`. The license and provenance README are present, but complete corresponding source, enabled third-party source materials, and build materials have not yet been supplied and reviewed. Merely pointing `BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE` at a file does not establish compliance or publish the archive.
2. **Code signing:** the installer and bundled executables are currently unsigned. Configure protected signing credentials, timestamp the artifacts, and verify the resulting signatures.
3. **End-to-end validation:** test both models, image and video processing, annotations, cancellation/cleanup, LabelImg, and installation/upgrade behavior on a clean Windows machine.
4. **Model hosting and application updates:** publish immutable model assets on a real HTTPS host and configure/test the actual GitHub Releases update feed. Do not invent URLs or claim these workflows are live before testing them.

See [Windows packaging, FFmpeg licensing, and signing](docs/WINDOWS_RELEASE.md), [application updates](docs/APP_UPDATES.md), [model distribution](docs/MODEL_DISTRIBUTION.md), and the [release validation checklist](docs/RELEASE_VALIDATION.md).

## Documentation

- [Project handover and prioritized roadmap](PROJECT_CONTEXT.md)
- [Model distribution and version management](docs/MODEL_DISTRIBUTION.md)
- [Application updates and GitHub Releases](docs/APP_UPDATES.md)
- [LabelImg setup and supported launch methods](docs/LABELIMG.md)
- [Release validation checklist](docs/RELEASE_VALIDATION.md)
- [Windows packaging, FFmpeg licensing, and signing](docs/WINDOWS_RELEASE.md)
