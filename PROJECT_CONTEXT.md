# Boundary Vision — Project Handover

This document records the current repository state for a new developer or coding session. Source code and checked outputs are the authority; a green build, a worker capability response, or a UI control does not establish that inference, external integrations, or release updates work end to end.

## A. Project overview

Boundary Vision is a Windows desktop application for local cricket object detection. It targets people who want to review cricket images and videos for **bats, balls, and stumps** without uploading media to a cloud inference service. The desktop UI is Electron, React, TypeScript, and Vite. Electron starts a local Python worker, which uses Ultralytics, PyTorch, and OpenCV to load the selected checkpoint and perform inference. Optional FFmpeg and FFprobe tools decode, timestamp, and encode videos; they are not bundled and are checked only when video processing is requested.

The product is intended to work without a user account, application database, or required network service for inference. Network access is only needed for optional, explicitly requested model downloads or configured application updates. No training, dataset, or permanent uploads subsystem belongs in this application.

## B. Original requirements and product decisions

- **Desktop application, not a website:** the project has an Electron main/preload process, native dialogs, Windows NSIS packaging, and a local worker. Vite serves the renderer during development and builds its production assets.
- **Local inference:** the main process sends JSON-line requests to a spawned Python process. There is no FastAPI service or remote inference endpoint.
- **Two original model families:** YOLO26n and YOLO26l checkpoints already exist. The originals must remain unchanged; the installer includes registry metadata, not checkpoint files.
- **Optional model storage:** model versions are installed into per-user application storage as needed. New versions do not silently become selected; old versions are retained until the user removes eligible managed copies.
- **Extensible model registry:** stable model IDs are distinct from version strings. Entries carry format, classes, file size, SHA-256, optional local development source, and optional HTTPS URL. New compatible model families can be added with accurate metadata.
- **Native input/output selection:** Electron native pickers select multiple images, one video, output directories, and the directory containing `labelImg.py`. Inputs are validated before work starts.
- **Image workflow:** single or multi-image inference, confidence threshold, conservative batch size choices (Auto/1/2/4), CPU or runtime-available CUDA, preview images, detection details, progress, and cancellation are present in the code/UI.
- **Video workflow:** inference sampling FPS and output FPS are configured separately. FFprobe frame presentation timestamps are streamed alongside FFmpeg decoded frames; sampled detections are held between model calls and applied to the latest source frame. The encoded output is constant frame rate at the selected output FPS and clipped to the intended duration. Audio is carried through when available with a source offset adjustment.
- **Annotation output:** image and video-frame exports support YOLO TXT, Pascal VOC XML, and CreateML JSON. There is no COCO export. Video frame annotation exports contain labels but do not extract frame images by default.
- **Optional LabelImg:** users select and persist the folder containing `labelImg.py`; the application validates that folder's dedicated `.venv` interpreter and required `PyQt5`/`lxml` dependencies before launching the script with that interpreter. A user action can also build a separate dataset folder with paired source images and YOLO or Pascal VOC labels. Python, LabelImg, and their dependencies are not installed or bundled. Video frames are not passed to LabelImg as an image dataset.
- **Independent update channels:** application updates use `electron-updater`/GitHub Releases. Model version updates use a separately fetched registry and hosted checkpoint assets. The model channel has published assets; no application update release/feed is currently published or tested.
- **User data and safety:** settings and managed checkpoints live under Electron `userData`; selected model ID/version persist there. Inputs and original checkpoints are not written by inference or removed by Model Manager. Temporary video data is staged under the selected output directory and cleaned after failure/cancellation.
- **Distribution independence:** packaged runtime resources resolve from Electron's `process.resourcesPath`, not the developer working directory or activated virtualenv. The packaged PyInstaller worker contains Python and inference dependencies; development mode uses `backend/.venv`. FFmpeg/FFprobe are downloaded on demand into per-user application data.

These decisions are reflected in current code and the earlier project requirements. The repository does not record a separate formal product decision log or numeric model evaluation report.

## C. Models and recorded metadata

Original checkpoint files:

| Registry ID | Version | Checkpoint | Size | SHA-256 | Class map |
|---|---|---|---:|---|---|
| `yolo26n` | `baseline-50-epoch` | `cricket_yolo26n_best.pt` | 5,430,469 bytes | `34b16af862199dcf11165e37fd5907ab9bfcd6b29d8e094547851c5265e4c450` | 0 Bat, 1 Ball, 2 Stump |
| `yolo26l` | `baseline-50-epoch` | `cricket_yolo26l_best.pt` | 52,958,181 bytes | `3c0844e8221b33f30665e7f1c33cccad419301ec5d2de774d66c7bfb3e3f5932` | 0 Bat, 1 Ball, 2 Stump |

The two current checkpoint file hashes were re-read during handover preparation and match the registry values. This verifies bytes only; it does not load the models or establish their inference accuracy. The registry descriptions contain qualitative validation language, but no numeric precision, recall, mAP, validation set, or current runtime-performance figures are recorded in the checked project documentation. Do not repeat numeric metrics or interpret the “50-epoch” version string as evidence of current performance.

`models/registry.json` is schema version 2. Each model has a stable `id`, a `latestVersion`, and version entries. Each ID currently has only `baseline-50-epoch`, format `ultralytics-yolo`, and a direct GitHub Release download URL. `developmentSource` names an optional local checkpoint in `models/`; model weights are distributed separately in `models-v1` and are not required in a clone. The public registry still has a legacy `minimumPython` field; the application ignores it and no longer applies a Python-version threshold.

Development checkpoints and managed user copies are separate:

- Optional development files may be downloaded into repository `models/`; the package script verifies their declared size/hash when present and strips `developmentSource` from the packaged registry. Missing weights do not block packaging, and packaging does not download or bundle them.
- Explicit development installation copies into `userData/models/{id}/{version}/{filename}`. Hosted downloads use this same managed area.
- Selected ID/version are saved to `userData/settings.json`. Older managed versions remain until explicitly removed; originals in the project `models/` folder are not removable through Model Manager.
- Downloads are HTTPS-only, size-limited, hashed, then loaded by the Python worker for class-order/runtime validation before commit. The old version remains. Selection is separate from installation; selected or actively used versions cannot be removed.
- Registry checks reject unsupported model formats. Actual runtime compatibility is determined by worker dependency imports, checkpoint loading and class validation, and successful inference. Development and packaging remain pinned to `.python-version`; the packaged worker carries its own Python runtime and dependencies.

The public [`models-v1` GitHub Release](https://github.com/SamirShaikh05/Boundary-Vision/releases/tag/models-v1) contains both checkpoint assets. Their published sizes and SHA-256 digests match the local checkpoint files and registry metadata. The app fetches the current registry from `https://raw.githubusercontent.com/SamirShaikh05/Boundary-Vision/main/models/registry.json`, refreshes it at most every 15 minutes, and falls back to the bundled registry on network/validation failure. This confirms hosted metadata and assets, not a successful packaged download or inference test. `models/hosting.example.json` is a separate unconfigured template; `BOUNDARY_VISION_MODEL_BASE_URL`, if set for packaging, generates versioned URLs, and the build script does not upload assets.

## D. Architecture and repository map

Generated output, virtual environments, caches, and ignored staging files are omitted from this source-oriented tree. The current workspace also contains ignored `.venv` backups, `backend/dist`, `frontend/dist`, `frontend/dist-electron`, `frontend/release`, `frontend/build-resources`, and `runtime/build`; these are not source requirements to commit.

```text
Boundary Vision/
├── .gitignore
├── .nvmrc
├── .python-version
├── README.md
├── PROJECT_CONTEXT.md
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── annotations.py
│   │   ├── devices.py
│   │   ├── image_inference.py
│   │   ├── model_cache.py
│   │   ├── paths.py
│   │   ├── schemas.py
│   │   ├── video_inference.py
│   │   └── worker.py
│   ├── tests/test_models.py
│   ├── requirements.txt
│   ├── requirements-build.txt
│   ├── requirements-release.txt
│   └── worker_entry.py
├── docs/
│   ├── APP_UPDATES.md
│   ├── LABELIMG.md
│   ├── MODEL_DISTRIBUTION.md
│   ├── RELEASE_VALIDATION.md
│   └── WINDOWS_RELEASE.md
├── frontend/
│   ├── build/                 # checked-in icon assets
│   ├── electron/
│   │   ├── main.ts
│   │   ├── modelManager.ts
│   │   ├── preload.ts
│   │   └── types.ts
│   ├── scripts/package-windows.ps1
│   ├── src/{App.tsx,main.tsx,styles.css}
│   ├── electron-builder.config.cjs
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── tsconfig.electron.json
│   └── vite.config.mts
├── models/
│   ├── cricket_yolo26n_best.pt (optional local download; Git-ignored)
│   ├── cricket_yolo26l_best.pt (optional local download; Git-ignored)
│   ├── hosting.example.json
│   └── registry.json
```

**Renderer → inference data flow:** `frontend/src/App.tsx` calls the narrow `window.boundaryVision` API declared in `frontend/electron/types.ts`. `preload.ts` maps those calls to IPC channels. `main.ts` validates file paths, options, selected model version, and managed paths, then spawns the packaged PyInstaller executable or, in development, `backend/.venv` running `worker_entry.py`. Worker requests/responses use JSON lines with the `@@BOUNDARY_VISION@@` prefix. `worker.py` dispatches capabilities, model validation, image inference, or video inference. Results and progress events return through Electron IPC to the React UI. Python writes output files to the user's selected output directory; images are read as inputs, not overwritten.

**Important modules:**

- `frontend/electron/main.ts`: BrowserWindow security/navigation policy, native dialogs, safe preload IPC handlers, process lifecycle/cancellation, output preview protocol, app updater, model manager coordination, and LabelImg process launch/export.
- `frontend/electron/preload.ts` and `types.ts`: renderer-safe API and typed request/result state. Renderer Node integration is disabled; context isolation and sandbox are enabled.
- `frontend/electron/modelManager.ts`: schema validation, version catalog, compatibility, install/download/hash/validation/commit, selection persistence, and guarded removal.
- `backend/app/worker.py`: worker protocol and action dispatch. `worker_entry.py` disables Ultralytics auto-install before worker startup.
- `backend/app/model_cache.py`: checkpoint size/SHA/class-order checks and in-worker model cache.
- `image_inference.py`, `video_inference.py`, `annotations.py`, `devices.py`: local inference, device checks, streaming video pipeline, and annotation encoders.
- `frontend/electron-builder.config.cjs` and `scripts/package-windows.ps1`: GitHub publishing configuration and Windows worker/resource/NSIS assembly.

**Packaged layout:** The Windows app packages the one-folder worker at `resources/backend/boundary-worker`, including its Python runtime and ML dependencies. Packaged inference does not require a system Python installation. Registry metadata is under `resources/models`; FFmpeg/FFprobe are not bundled, but a user-approved setup downloads a pinned Gyan.dev Essentials archive when video processing is first requested and keeps the verified executables under `userData/tools/ffmpeg/9.0.2`. Checkpoints are excluded. Model copies/settings stay in Electron `userData`.

## E. Feature implementation and verification status

“Implemented” below describes code that is present. Verification is listed separately.

| Feature | Current implementation | Evidence | Verification performed | Remaining gaps |
|---|---|---|---|---|
| Electron shell and secure IPC | Sandboxed renderer, context isolation, no renderer Node integration; narrow preload API and navigation restrictions | `frontend/electron/main.ts`, `preload.ts`, `types.ts` | TypeScript/build checks; packaged Electron output assembled | No full security review or clean-machine app interaction pass recorded |
| Image inference | Multi-image validation, selected model, confidence, preview/save, detections and result cards | `backend/app/image_inference.py`, `frontend/src/App.tsx` | Earlier records establish build and worker capability checks only | No real inference with either checkpoint is established in the recorded validation |
| Image batches | UI offers Auto/1/2/4; backend batches and falls back to single-image prediction on memory failures | `image_inference.py`, `App.tsx` | Code/build inspection | No batch inference or fallback runtime test |
| Device detection | CPU always listed; CUDA device probed if PyTorch can allocate/synchronize; packaged runtime is CPU-only | `backend/app/devices.py`, `requirements-release.txt` | Packaged worker reports CPU | No CUDA packaging or actual GPU check |
| Annotation exports | YOLO TXT, VOC XML, CreateML JSON; normalized YOLO and pixel-coordinate VOC/CreateML writers | `backend/app/annotations.py` | Type/build only | Actual boxes/files not inspected from inference |
| Video processing | FFprobe timestamps and FFmpeg raw-frame streams; bounded frame/model memory, independent inference/output FPS, held detections, H.264/AAC MP4, staging and progress/cancel | `backend/app/video_inference.py`, `frontend/electron/main.ts` | Historical synthetic VFR timestamp smoke is recorded in validation doc; packaged build succeeded | No actual model-powered video export or user media review |
| VFR timestamps | Frame PTS and packet duration are streamed; missing, invalid, or out-of-order timestamps are rejected rather than inferred from nominal FPS. Output is CFR at selected FPS, so source VFR is sampled/aligned then rendered on explicit output cadence | `_frame_timestamps`, `process_video`, `README.md` | Synthetic fixture smoke only (historical record) | Real VFR end-to-end behavior, gaps, nonzero starts, and output PTS/duration conformance remain unverified |
| Progress/cancellation | Image/video progress events; worker cancel request; child cleanup; video staging uses temporary directory and output rename | `main.ts`, `worker.py`, `video_inference.py`, `App.tsx` | Build only | No live cancellation/cleanup, disk-full, or unwritable-path test |
| Model Manager | Version catalog, development copy or remote install, progress/cancel, select, version-specific remove | `modelManager.ts`, Model Manager view | Package verifies original size/hash; no select/install/removal session exercised here | No actual checkpoint inference/managed lifecycle E2E |
| Optional model downloads | Remote registry, HTTPS redirects restricted, exact size/SHA, staged Python load/class verification, old version kept | `modelManager.ts`, `worker.py`, `model_cache.py` | Public registry and release asset size/SHA metadata match local entries | Packaged download, runtime load, and inference remain unverified |
| Application auto-update | Startup/delayed and periodic checks, Settings manual check, user-controlled download/restart, progress/error handling, disallows update restart during inference/model work | `main.ts`, `APP_UPDATES.md` | Code/build inspection only | No application update release or local `app-update.yml`; no live check/download/install |
| Model version updates | Stable IDs separate from versions; explicit install and separate selection; integrity/runtime/class validation; old versions retained | `registry.json`, `modelManager.ts`, `MODEL_DISTRIBUTION.md` | Public model release and matching metadata inspected | No hosted install/session or model inference test |
| LabelImg | Settings persists a folder containing `labelImg.py`; main-process launch uses `py labelImg.py`; explicit dataset export remains available | `main.ts`, `preload.ts`, `App.tsx`, `LABELIMG.md` | TypeScript/build passed; temporary Python-script launch/error checks passed; no actual LabelImg installation is available | Real LabelImg launch/export round-trip and persisted setting restart test remain unverified |
| Windows installer | Electron Builder NSIS x64, icon, PyInstaller worker and registry resources; FFmpeg/FFprobe excluded | `package.json`, package script, `WINDOWS_RELEASE.md` | Existing artifact inspection and current source/config inspection | Current working-tree package has not been built; no clean-VM installation |
| Optional video tools | User-approved download of pinned FFmpeg/FFprobe archive on first video request; verified tools stored in per-user data | `ffmpegManager.ts`, `main.ts`, `package.json`, `WINDOWS_RELEASE.md` | Source/build tests pending | No current installer or real video job verified with on-demand setup |
| Windows signing | Build can use electron-builder certificate env vars; release script requires certificate env variable for publish | package script, `WINDOWS_RELEASE.md` | Earlier installer/Electron/worker reported `NotSigned` | Real certificate, timestamped signing, and signature verification remain external |
| Clean-machine installation | Packaged paths avoid developer cwd and venv at runtime | `main.ts`, package script | Unpacked worker capability command succeeded on developer machine | No clean Windows VM/account install, update, inference, upgrade, uninstall test |
| Real model inference/E2E | Inference paths and model test script exist | `backend/tests/test_models.py`, `image_inference.py`, `video_inference.py` | No model loading/inference test result established in the recorded validation | Both model inference and annotation outputs remain unverified |

## F. Current configuration and release state

Versions observed in this checkout/build environment:

| Component | Version/configuration |
|---|---|
| Node.js | 26.11.1 (`.nvmrc`; `node --version` also returned v26.11.1) |
| npm | 11.20.0 (`packageManager`; installed npm also 11.20.0) |
| Python | 3.15.2 (`.python-version`; development and release build environment pin) |
| Electron | 45.0.0 |
| React / React DOM | 19.3.1 |
| Vite | 8.3.5 |
| TypeScript | 7.0.2 |
| electron-builder / electron-updater | 26.18.0 / 6.8.11 |
| PyTorch | 2.14.1+cpu |
| Ultralytics | 8.4.190 |
| OpenCV distribution/runtime | `opencv-python` 5.0.0.93; imported `cv2.__version__` reports 5.0.0 |
| PyInstaller | 6.22.3 |
| FFmpeg / FFprobe (previous build) | Gyan `9.0.2-full_build-www.gyan.dev`; Windows x64 static full build, GPLv3-or-later configuration including `--enable-gpl`, `--enable-version3`, `libx264`, `libx265`. Not bundled by current packaging. |
| Boundary Vision | 0.1.0, Windows x64 NSIS target |

`backend/requirements.txt` remains intentionally unpinned for developer setup and includes CPU PyTorch's extra index. `backend/requirements-release.txt` pins the Windows x64 build environment's package versions, but not wheel hashes. The release script requires Python exactly matching `.python-version` to make the build reproducible. This build pin does not constrain users of the packaged app: its PyInstaller worker includes Python and inference dependencies. `requirements-build.txt` still references the unpinned developer requirements; the current release script uses `requirements-release.txt`.

Configuration and external variables:

- `.nvmrc`: `26.11.1`; `.python-version`: `3.15.2`.
- `frontend/package.json`: Electron Builder app ID `com.boundaryvision.desktop`, product `Boundary Vision`, `asar`, icon `frontend/build/icon.ico`, NSIS x64 per-user install, desktop/start-menu shortcuts. `package:win` creates a local installer; `release:win` sets publish mode.
- `frontend/electron-builder.config.cjs`: reads `BOUNDARY_VISION_GITHUB_OWNER` and `BOUNDARY_VISION_GITHUB_REPO`; configures GitHub draft release only when both are set. No owner/repository URL is present in the project. `GH_TOKEN` is needed by publishing; no token belongs in source.
- Signing variables used/mentioned by the packager: `CSC_LINK` or `WIN_CSC_LINK`; optionally `CSC_KEY_PASSWORD`. None are configured here.
- `BOUNDARY_VISION_MODEL_BASE_URL`: optional HTTPS origin base, no credentials/query/fragment. If set, it generates immutable-path URLs `/models/{id}/{version}/{filename}` in the packaged registry. The current registry also has direct GitHub Release asset URLs.
- `YOLO_AUTOINSTALL=false` is set for worker and packaging subprocesses to prevent runtime package installation.
- Model storage and settings use `app.getPath('userData')`; LabelImg path and selected model ID/version share `settings.json`.
- `frontend/build-resources/` is ignored by `.gitignore`. The package script generates model registry resources during a build; FFmpeg/FFprobe are not staged or bundled.
- `models/hosting.example.json` is an unconfigured template; the current assets are hosted in the public `models-v1` GitHub Release.

## G. Previously recorded checks and exact results

The build, packaging, worker, FFmpeg, and synthetic-video results below are carried forward from earlier validation records; they were not rerun during this documentation reconciliation. Checkpoint sizes and hashes were rechecked during this pass.

- Earlier records report that `npm run build` passed (TypeScript main/renderer checks and Vite production build).
- Earlier records report that the PowerShell parser check for `frontend/scripts/package-windows.ps1` passed.
- Earlier records report that `npm audit --omit=dev` found zero production npm advisories. This is not a Python package vulnerability audit.
- Earlier records report that `npm run package:win` produced `frontend/release/Boundary-Vision-Setup-0.1.0-x64.exe` (458,039,832 bytes), unsigned.
- Earlier records report that the unpacked packaged worker, run with `{"action":"capabilities"}`, emitted CPU-only devices and Python `3.15.2`. This establishes worker startup/capability response, not model loading or detection.
- Earlier records report staged FFmpeg `9.0.2-full_build-www.gyan.dev`; `-L` reported GPL v3 or later, flags included GPL/version3, and the `libx264` encoder required by the video writer was present.
- Earlier SHA-256 comparisons reportedly found packaged FFmpeg, FFprobe, FFmpeg license, and upstream README byte-identical to `frontend/build-resources/ffmpeg/` inputs.
- During this documentation pass, both checkpoint files' byte sizes and SHA-256 hashes were measured and matched the registry entries in section C. The package script also checks sizes/hashes when packaging development sources.
- An earlier synthetic VFR smoke fixture is recorded in `docs/RELEASE_VALIDATION.md`. It is not a real camera/editor-media conformance run.
- The previously inspected local packaged build had no `resources/app-update.yml`; startup update checks were disabled for that build. The checked-in registry has model download URLs, and the matching assets are published in `models-v1`.
- Earlier records report that a previous installer, Electron executable, worker, FFmpeg, and FFprobe all returned Authenticode `NotSigned`. FFmpeg and FFprobe are no longer part of the installer.

Not verified: loading either checkpoint with `backend/tests/test_models.py`; real image inference; real model-powered video processing; real VFR end-to-end with inference; annotation correctness from inference; real cancellation/temp cleanup under jobs; a LabelImg launch or dataset round trip; hosted model install/update; live GitHub update check/download/restart; and installation/operation on a clean Windows VM or machine. Do not turn build or capability results into inference claims.

## H. Outstanding blockers

1. **Application updates:** no application update release/feed is published or tested. The local package build lacks `app-update.yml`; older installers without it need a manual update-enabled bootstrap installer.
2. **Model hosting validation:** checkpoint assets and the remote registry are published, but packaged installation, runtime loading, and inference still require end-to-end verification.
3. **Signing:** installer and key binaries are unsigned. An organization-controlled Authenticode certificate/signing service, protected key handling, SHA-256 signatures, RFC 3161 timestamping, and verification are external requirements.
4. The Python release lock pins package versions, not wheel hashes. Use a controlled package index and retain exact build artifacts for stronger provenance/reproducibility.
5. PyInstaller warned that optional `lap` (Ultralytics tracking) is missing. Tracking is not implemented as a product feature and is not used by current image/video detection paths; do not add it without a confirmed product requirement. Other warning messages should be reviewed for used paths before changing the bundle.
6. The packaged runtime is CPU-only. Its worker starts, but no real checkpoint inference has been verified in the packaged application.
7. No clean-machine installation, upgrade, update, model storage persistence, uninstall, or user-data retention run has been completed.

Items 1–3 require app-release configuration, trusted signing, and completion of validation. The model assets already have public Release URLs; do not claim the packaged model workflow has passed until it is tested. Code-side guards, docs, lock maintenance, build checks, and UI/inference validation can be continued in the repository. No credential, model version/hash, or source package should be guessed.

## I. Intended update and distribution workflow

### Application release

1. Configure the real public GitHub owner/repository and protected publishing credentials; increment app version in `frontend/package.json` and lockfile.
2. Use a validated Python release lock and signed Windows build; FFmpeg/FFprobe are optional and are not part of the installer.
3. Run `npm run release:win` from Windows x64 with `BOUNDARY_VISION_GITHUB_OWNER`, `BOUNDARY_VISION_GITHUB_REPO`, `GH_TOKEN`, and signing variables configured. The script asks electron-builder to create/upload a draft.
4. Inspect installer/blockmap/`latest.yml`/`app-update.yml`, verify signatures and release assets, then test from an installed signed update-enabled build against a later test release. Publish the draft only after checks. This workflow is configured in code, not operational today.
5. Users on builds without feed metadata require one manual update-enabled bootstrap install before in-app updates can work.

### Model version release

1. Preserve the stable model `id`; create a new immutable version path/object, never replace served bytes for an existing version.
2. Independently fetch the final hosted checkpoint and record exact size and SHA-256. Obtain real class mapping, format, and behavior/change notes from the model owner. Verify runtime compatibility by importing dependencies, loading the checkpoint, and exercising inference.
3. Add the version and URL to `models/registry.json`; set `latestVersion` only intentionally. The existing baseline assets use direct GitHub Release URLs. `BOUNDARY_VISION_MODEL_BASE_URL` is an optional alternative; the package script validates metadata and can generate URLs, but does not upload models.
4. Test against actual hosted bytes. Users explicitly install, let the app verify size/hash/runtime/classes, and separately select the installed version. App upgrades keep user-managed models/settings; adding a model should not require reinstalling the desktop application.

PowerShell installation instructions can only name a real installer URL after a public signed release exists. Do not invent one now.

## J. Recommended roadmap

### Code and product validation

| Priority | Goal and completion criterion | Relevant files/subsystems | Prerequisites |
|---:|---|---|---|
| 1 | Run real image inference with both YOLO26n and YOLO26l. Check empty detections, confidence thresholds, device and batch choices, previews, and output files against source-model results. | `backend/tests/test_models.py`, `backend/app/image_inference.py`, Model Manager and image UI | Representative test images and both checkpoints |
| 2 | Validate model-powered video cadence and real VFR behavior, annotation formats, cancellation/cleanup, and error paths including unwritable or full output storage. | `backend/app/video_inference.py`, `backend/app/annotations.py`, `docs/RELEASE_VALIDATION.md` | Models and representative CFR/VFR media with known timing |
| 3 | Launch LabelImg through the saved `labelImg.py` folder and round-trip YOLO/VOC exports, including paths with spaces and collision cases. | LabelImg IPC in `frontend/electron/main.ts`, Settings/results UI, `docs/LABELIMG.md` | LabelImg installation in a test environment |
| 4 | Validate installation, inference, model lifecycle, user-data persistence, upgrade, and uninstall on a clean Windows 10/11 x64 machine. | `frontend/release/`, `docs/RELEASE_VALIDATION.md` | Clean VM/account; signed test build and hosted models for relevant cases |
| 5 | Complete regression checks and record exact command output and evidence for each verified behavior. | Relevant source/tests and release validation docs | Completion of the focused checks above |

### External release blockers

These can be prepared alongside code-side validation, but must be resolved before public distribution:

1. Configure the actual public GitHub repository, publishing access, and a test release; verify update metadata, download, and installation.
2. Provision and verify trusted Windows signing and timestamped artifacts.
3. For future versions, publish immutable checkpoint assets and verify served bytes against registry metadata. The baseline assets are already published; packaged installation still needs validation.
4. Publish only after the applicable hosting, signing, and end-to-end validation requirements are satisfied.

## K. Instructions for a fresh Codex session

1. Read `PROJECT_CONTEXT.md`, the relevant docs under `docs/`, and then inspect the live source/config before making changes.
2. Confirm current Git/worktree, dependency, and generated-artifact state; the developer workspace may contain ignored build output and local virtualenv backups.
3. Preserve both original `.pt` checkpoints and working image/video, model-management, update, and LabelImg code. Avoid unnecessary rewrites or unrelated features.
4. Never invent test results, URLs, hashes, model versions, release tags, licensing status, or compatibility claims. Do not call something verified merely because the build passes or the worker starts.
5. Do not modify inference behavior, checkpoint files, distribution behavior, or runtime settings for a documentation-only task.
6. Do not require sample media for unrelated code or documentation work. Use real media only for the focused inference/video checks that need it.
7. Report exact files changed, commands/checks actually executed and their output, and remaining blockers. Keep public release blocked until source, hosting, and signing requirements are genuinely satisfied.
