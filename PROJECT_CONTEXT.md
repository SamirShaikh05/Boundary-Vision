# Boundary Vision — Project Handover

This document records the current repository state for a new developer or coding session. Source code and checked outputs are the authority; a green build, a worker capability response, or a UI control does not establish that inference, external integrations, or release updates work end to end.

## A. Project overview

Boundary Vision is a Windows desktop application for local cricket object detection. It targets people who want to review cricket images and videos for **bats, balls, and stumps** without uploading media to a cloud inference service. The desktop UI is Electron, React, TypeScript, and Vite. Electron starts a local Python worker, which uses Ultralytics, PyTorch, and OpenCV to load the selected checkpoint and perform inference. FFmpeg and FFprobe decode, timestamp, and encode videos.

The product is intended to work without a user account, application database, or required network service for inference. Network access is only needed for optional, explicitly requested model downloads or configured application updates. No training, dataset, or permanent uploads subsystem belongs in this application.

## B. Original requirements and product decisions

- **Desktop application, not a website:** the project has an Electron main/preload process, native dialogs, Windows NSIS packaging, and a local worker. Vite serves the renderer during development and builds its production assets.
- **Local inference:** the main process sends JSON-line requests to a spawned Python process. There is no FastAPI service or remote inference endpoint.
- **Two original model families:** YOLO26n and YOLO26l checkpoints already exist. The originals must remain unchanged; the installer includes registry metadata, not checkpoint files.
- **Optional model storage:** model versions are installed into per-user application storage as needed. New versions do not silently become selected; old versions are retained until the user removes eligible managed copies.
- **Extensible model registry:** stable model IDs are distinct from version strings. Entries carry format, classes, file size, SHA-256, minimum Python, optional local development source, and optional HTTPS URL. New compatible model families can be added with accurate metadata.
- **Native input/output selection:** Electron native pickers select multiple images, one video, output directories, and LabelImg launch paths. Inputs are validated before work starts.
- **Image workflow:** single or multi-image inference, confidence threshold, conservative batch size choices (Auto/1/2/4), CPU or runtime-available CUDA, preview images, detection details, progress, and cancellation are present in the code/UI.
- **Video workflow:** inference sampling FPS and output FPS are configured separately. FFprobe frame presentation timestamps are streamed alongside FFmpeg decoded frames; sampled detections are held between model calls and applied to the latest source frame. The encoded output is constant frame rate at the selected output FPS and clipped to the intended duration. Audio is carried through when available with a source offset adjustment.
- **Annotation output:** image and video-frame exports support YOLO TXT, Pascal VOC XML, and CreateML JSON. There is no COCO export. Video frame annotation exports contain labels but do not extract frame images by default.
- **Optional LabelImg:** users configure an installed executable, script plus explicitly selected Python interpreter, or supported Python environment. A user action builds a separate dataset folder with paired source images and YOLO or Pascal VOC labels. It does not install Python packages or auto-launch. Video frames are not passed to LabelImg as an image dataset.
- **Independent update channels:** application updates use `electron-updater`/GitHub Releases. Model version updates are handled separately by Model Manager. Neither channel currently has working live hosting configured.
- **User data and safety:** settings and managed checkpoints live under Electron `userData`; selected model ID/version persist there. Inputs and original checkpoints are not written by inference or removed by Model Manager. Temporary video data is staged under the selected output directory and cleaned after failure/cancellation.
- **Distribution independence:** packaged runtime resources resolve from Electron's `process.resourcesPath`, not the developer working directory or activated virtualenv. Development mode still expects `backend/.venv` and external FFmpeg/FFprobe on PATH.

These decisions are reflected in current code and the earlier project requirements. The repository does not record a separate formal product decision log or numeric model evaluation report.

## C. Models and recorded metadata

Original checkpoint files:

| Registry ID | Version | Checkpoint | Size | SHA-256 | Class map |
|---|---|---|---:|---|---|
| `yolo26n` | `baseline-50-epoch` | `cricket_yolo26n_best.pt` | 5,430,469 bytes | `34b16af862199dcf11165e37fd5907ab9bfcd6b29d8e094547851c5265e4c450` | 0 Bat, 1 Ball, 2 Stump |
| `yolo26l` | `baseline-50-epoch` | `cricket_yolo26l_best.pt` | 52,958,181 bytes | `3c0844e8221b33f30665e7f1c33cccad419301ec5d2de774d66c7bfb3e3f5932` | 0 Bat, 1 Ball, 2 Stump |

The two current checkpoint file hashes were re-read during handover preparation and match the registry values. This verifies bytes only; it does not load the models or establish their inference accuracy. The registry descriptions contain qualitative validation language, but no numeric precision, recall, mAP, validation set, or current runtime-performance figures are recorded in the checked project documentation. Do not repeat numeric metrics or interpret the “50-epoch” version string as evidence of current performance.

`models/registry.json` is schema version 2. Each model has a stable `id`, a `latestVersion`, and version entries. At present each ID has only `baseline-50-epoch`, format `ultralytics-yolo`, minimum Python `3.15`, and null `downloadUrl`. Its `developmentSource` points at the existing checkpoint in `models/`.

Development checkpoints and managed user copies are separate:

- Development files remain in repository `models/`; the package script verifies their declared size/hash and strips `developmentSource` from the packaged registry.
- Explicit development installation copies into `userData/models/{id}/{version}/{filename}`. Hosted downloads use this same managed area.
- Selected ID/version are saved to `userData/settings.json`. Older managed versions remain until explicitly removed; originals in the project `models/` folder are not removable through Model Manager.
- Downloads are HTTPS-only, size-limited, hashed, then loaded by the Python worker for class-order/runtime validation before commit. The old version remains. Selection is separate from installation; selected or actively used versions cannot be removed.
- Compatibility checks include supported format and the bundled Python minimum. The supported runtime format is currently `ultralytics-yolo`.

There are no hosted model assets or URLs. `models/hosting.example.json` has a null base URL and is an example only. `BOUNDARY_VISION_MODEL_BASE_URL`, when configured for packaging, generates versioned URLs; the build script does not upload assets or establish that objects exist.

## D. Architecture and repository map

Generated output, virtual environments, caches, and ignored staging files are omitted from this source-oriented tree. The current workspace also contains ignored `.venv` backups, `backend/dist`, `frontend/dist`, `frontend/dist-electron`, `frontend/release`, `frontend/build-resources`, and `runtime/build`; these are not source requirements to commit.

```text
Boundary Vision/
├── .gitignore
├── .nvmrc
├── .python-version
├── README.md
├── PROJECT_CONTEXT.md
├── package-lock.json
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
│   ├── cricket_yolo26n_best.pt
│   ├── cricket_yolo26l_best.pt
│   ├── hosting.example.json
│   └── registry.json
└── runtime/temp/             # temporary workspace only
```

**Renderer → inference data flow:** `frontend/src/App.tsx` calls the narrow `window.boundaryVision` API declared in `frontend/electron/types.ts`. `preload.ts` maps those calls to IPC channels. `main.ts` validates file paths, options, selected model version, and managed paths, then spawns either the development Python interpreter or packaged one-folder worker. Worker requests/responses use JSON lines with the `@@BOUNDARY_VISION@@` prefix. `worker.py` dispatches capabilities, model validation, image inference, or video inference. Results and progress events return through Electron IPC to the React UI. Python writes output files to the user's selected output directory; images are read as inputs, not overwritten.

**Important modules:**

- `frontend/electron/main.ts`: BrowserWindow security/navigation policy, native dialogs, safe preload IPC handlers, process lifecycle/cancellation, output preview protocol, app updater, model manager coordination, and LabelImg process launch/export.
- `frontend/electron/preload.ts` and `types.ts`: renderer-safe API and typed request/result state. Renderer Node integration is disabled; context isolation and sandbox are enabled.
- `frontend/electron/modelManager.ts`: schema validation, version catalog, compatibility, install/download/hash/validation/commit, selection persistence, and guarded removal.
- `backend/app/worker.py`: worker protocol and action dispatch. `worker_entry.py` disables Ultralytics auto-install before worker startup.
- `backend/app/model_cache.py`: checkpoint size/SHA/class-order checks and in-worker model cache.
- `image_inference.py`, `video_inference.py`, `annotations.py`, `devices.py`: local inference, device checks, streaming video pipeline, and annotation encoders.
- `frontend/electron-builder.config.cjs` and `scripts/package-windows.ps1`: GitHub publishing configuration and Windows worker/resource/NSIS assembly.

**Packaged layout:** PyInstaller builds a Windows one-folder worker with its Python runtime and dependencies under `resources/backend/boundary-worker`. Electron resolves FFmpeg/FFprobe from `resources/ffmpeg`; registry metadata is under `resources/models`. Checkpoints are excluded. Model copies/settings stay in Electron `userData`. This packaged architecture was inspected; only the worker capabilities handshake was run, not inference.

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
| Optional model downloads | HTTPS redirects restricted, exact size/SHA, staged Python load/class verification, old version kept | `modelManager.ts`, `worker.py`, `model_cache.py` | Code/build inspection; no remote URL exists | Cannot test download, interruption, or compatibility against hosted assets |
| Application auto-update | Startup/manual check, user-controlled download/restart, progress/error handling, disallows update restart during inference/model work | `main.ts`, `APP_UPDATES.md` | Code/build inspection only | No repository feed or `app-update.yml`; no live release check/download/install |
| Model version updates | Stable IDs separate from versions; explicit install and separate selection; integrity/runtime/class validation; old versions retained | `registry.json`, `modelManager.ts`, `MODEL_DISTRIBUTION.md` | Registry/checkpoint metadata inspected | No published hosted versions or live install |
| LabelImg | Settings path for executable, script+Python, or recognized environment; bounded folder scan; explicit dataset export and launch, no automatic launch | `main.ts`, `preload.ts`, `App.tsx`, `LABELIMG.md` | UI/IPC build checked; strings present in latest app.asar | No installed LabelImg process launch or export round-trip verified |
| Windows installer | Electron Builder NSIS x64, icon, PyInstaller worker and FFmpeg/registry external resources | `package.json`, package script, `WINDOWS_RELEASE.md` | `npm run package:win` completed; 0.1.0 installer generated | Unsigned; not installed/tested in clean VM; no update feed |
| FFmpeg legal/source status | Bundles Gyan full build executable, GPL license and README/provenance; release script guards exact reviewed binary profile and requires source archive path in publish mode | package script, `build-resources/ffmpeg`, `WINDOWS_RELEASE.md` | Version/license flags/provenance checked; packaged files SHA-identical to staged files | Complete corresponding source and third-party notices/materials unavailable; archive path alone is not compliance |
| Windows signing | Build can use electron-builder certificate env vars; release script requires certificate env variable for publish | package script, `WINDOWS_RELEASE.md` | Installer/Electron/worker/FFmpeg/FFprobe reported `NotSigned` | Real certificate, timestamped signing, and signature verification remain external |
| Clean-machine installation | Packaged paths avoid developer cwd and venv at runtime | `main.ts`, package script | Unpacked worker capability command succeeded on developer machine | No clean Windows VM/account install, update, inference, upgrade, uninstall test |
| Real model inference/E2E | Inference paths and model test script exist | `backend/tests/test_models.py`, `image_inference.py`, `video_inference.py` | No model loading/inference test result established in the recorded validation | Both model inference and annotation outputs remain unverified |

## F. Current configuration and release state

Versions observed in this checkout/build environment:

| Component | Version/configuration |
|---|---|
| Node.js | 26.11.1 (`.nvmrc`; `node --version` also returned v26.11.1) |
| npm | 11.20.0 (`packageManager`; installed npm also 11.20.0) |
| Python | 3.15.2 (`.python-version`; release script enforces exact match) |
| Electron | 45.0.0 |
| React / React DOM | 19.3.1 |
| Vite | 8.3.5 |
| TypeScript | 7.0.2 |
| electron-builder / electron-updater | 26.18.0 / 6.8.11 |
| PyTorch | 2.14.1+cpu |
| Ultralytics | 8.4.190 |
| OpenCV distribution/runtime | `opencv-python` 5.0.0.93; imported `cv2.__version__` reports 5.0.0 |
| PyInstaller | 6.22.3 |
| FFmpeg / FFprobe | Gyan `9.0.2-full_build-www.gyan.dev`; Windows x64 static full build, GPLv3-or-later configuration including `--enable-gpl`, `--enable-version3`, `libx264`, `libx265` |
| Boundary Vision | 0.1.0, Windows x64 NSIS target |

`backend/requirements.txt` remains intentionally unpinned for developer setup and includes CPU PyTorch's extra index. `backend/requirements-release.txt` pins the Windows x64 build environment's package versions, but not wheel hashes. The release script also requires Python exactly matching `.python-version`. `requirements-build.txt` still references the unpinned developer requirements; the current release script uses `requirements-release.txt`.

Configuration and external variables:

- `.nvmrc`: `26.11.1`; `.python-version`: `3.15.2`.
- `frontend/package.json`: Electron Builder app ID `com.boundaryvision.desktop`, product `Boundary Vision`, `asar`, icon `frontend/build/icon.ico`, NSIS x64 per-user install, desktop/start-menu shortcuts. `package:win` creates a local installer; `release:win` sets publish mode.
- `frontend/electron-builder.config.cjs`: reads `BOUNDARY_VISION_GITHUB_OWNER` and `BOUNDARY_VISION_GITHUB_REPO`; configures GitHub draft release only when both are set. No owner/repository URL is present in the project. `GH_TOKEN` is needed by publishing; no token belongs in source.
- Signing variables used/mentioned by the packager: `CSC_LINK` or `WIN_CSC_LINK`; optionally `CSC_KEY_PASSWORD`. None are configured here.
- `BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE`: `release:win` requires it to point to an existing archive file. This check does not inspect contents and does not attach the archive to GitHub; a release owner must review and upload it to the draft.
- `BOUNDARY_VISION_MODEL_BASE_URL`: optional HTTPS origin base, no credentials/query/fragment. It generates immutable-path URLs `/models/{id}/{version}/{filename}` in the packaged registry. Currently unset.
- `YOLO_AUTOINSTALL=false` is set for worker and packaging subprocesses to prevent runtime package installation.
- Model storage and settings use `app.getPath('userData')`; LabelImg path and selected model ID/version share `settings.json`.
- `frontend/build-resources/` is ignored by `.gitignore`. The package script populates its FFmpeg and registry resources from PATH and the project registry during a build. A clean checkout needs a matching FFmpeg installation with upstream root `LICENSE` and `README.txt`; it cannot assume the local ignored staging files are tracked.
- `models/hosting.example.json` is a template with `baseUrl: null`. There is no active model host.

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
- The previously inspected packaged build had no `resources/app-update.yml`; startup update checks were disabled for that build. The checked-in model registry currently has null download URLs.
- Earlier records report that the installer, Electron executable, worker, FFmpeg, and FFprobe all returned Authenticode `NotSigned`.

Not verified: loading either checkpoint with `backend/tests/test_models.py`; real image inference; real model-powered video processing; real VFR end-to-end with inference; annotation correctness from inference; real cancellation/temp cleanup under jobs; a LabelImg launch or dataset round trip; hosted model install/update; live GitHub update check/download/restart; and installation/operation on a clean Windows VM or machine. Do not turn build or capability results into inference claims.

## H. Outstanding blockers

1. **Application updates:** no actual GitHub owner/repository or published release feed is configured. Older installers without `app-update.yml` need a manual update-enabled bootstrap installer.
2. **Model hosting:** no immutable checkpoint objects, HTTPS URL, or configured base URL exist; packaged model versions are therefore not downloadable.
3. **Signing:** installer and key binaries are unsigned. An organization-controlled Authenticode certificate/signing service, protected key handling, SHA-256 signatures, RFC 3161 timestamping, and verification are external requirements.
4. **FFmpeg redistribution:** the bundled Gyan `9.0.2-full_build` uses GPLv3 components including `libx264`. License and provenance README are included, but the complete corresponding source, enabled third-party source, and build materials have not been supplied or published. The FFmpeg process is separately spawned; this handover does not decide the effect on licensing of the rest of the application.
5. `BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE` only has an existence check. That alone does not establish completeness, license compliance, public availability, or correct attachment to a release.
6. The Python release lock pins package versions, not wheel hashes. Use a controlled package index and retain exact build artifacts for stronger provenance/reproducibility.
7. PyInstaller warned that optional `lap` (Ultralytics tracking) is missing. Tracking is not implemented as a product feature and is not used by current image/video detection paths; do not add it without a confirmed product requirement. Other warning messages should be reviewed for used paths before changing the bundle.
8. The packaged runtime is CPU-only. Its worker starts, but no real checkpoint inference has been verified in the packaged application.
9. No clean-machine installation, upgrade, update, model storage persistence, uninstall, or user-data retention run has been completed.

Items 1–3 and model hosting require real external repository, asset host, credentials, and signing service/certificate. FFmpeg source preparation/publication requires source/toolchain acquisition and review outside this source tree. Code-side guards, docs, lock maintenance, build checks, and UI/inference validation can be continued in the repository. No URL, credential, model version/hash, or source package should be guessed.

## I. Intended update and distribution workflow

### Application release

1. Configure the real public GitHub owner/repository and protected publishing credentials; increment app version in `frontend/package.json` and lockfile.
2. Use a validated Python release lock, matching FFmpeg/FFprobe, full corresponding-source package, signed Windows build, and release notes.
3. Run `npm run release:win` from Windows x64 with `BOUNDARY_VISION_GITHUB_OWNER`, `BOUNDARY_VISION_GITHUB_REPO`, `GH_TOKEN`, signing variables, and `BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE` configured. The script asks electron-builder to create/upload a draft; it does not validate source archive contents or attach that archive automatically.
4. Manually attach the reviewed FFmpeg source archive, inspect installer/blockmap/`latest.yml`/`app-update.yml`, verify signatures and release assets, then test from an installed signed update-enabled build against a later test release. Publish the draft only after checks. This workflow is configured in code, not operational today.
5. Users on builds without feed metadata require one manual update-enabled bootstrap install before in-app updates can work.

### Model version release

1. Preserve the stable model `id`; create a new immutable version path/object, never replace served bytes for an existing version.
2. Independently fetch the final hosted checkpoint and record exact size and SHA-256. Obtain real class mapping, format, minimum Python compatibility, and behavior/change notes from the model owner.
3. Add the version and URL to `models/registry.json`; set `latestVersion` only intentionally. Configure `BOUNDARY_VISION_MODEL_BASE_URL` only after host assets exist. The package script validates metadata and can generate the registry, but does not upload models.
4. Test against actual hosted bytes. Users explicitly install, let the app verify size/hash/runtime/classes, and separately select the installed version. App upgrades keep user-managed models/settings; adding a model should not require reinstalling the desktop application.

PowerShell installation instructions can only name a real installer URL after a public signed release exists. Do not invent one now.

## J. Recommended roadmap

### Code and product validation

| Priority | Goal and completion criterion | Relevant files/subsystems | Prerequisites |
|---:|---|---|---|
| 1 | Run real image inference with both YOLO26n and YOLO26l. Check empty detections, confidence thresholds, device and batch choices, previews, and output files against source-model results. | `backend/tests/test_models.py`, `backend/app/image_inference.py`, Model Manager and image UI | Representative test images and both checkpoints |
| 2 | Validate model-powered video cadence and real VFR behavior, annotation formats, cancellation/cleanup, and error paths including unwritable or full output storage. | `backend/app/video_inference.py`, `backend/app/annotations.py`, `docs/RELEASE_VALIDATION.md` | Models and representative CFR/VFR media with known timing |
| 3 | Launch LabelImg through each supported installation method and round-trip YOLO/VOC exports, including paths with spaces and collision cases. | LabelImg IPC in `frontend/electron/main.ts`, Settings/results UI, `docs/LABELIMG.md` | LabelImg installation in a test environment |
| 4 | Validate installation, inference, model lifecycle, user-data persistence, upgrade, and uninstall on a clean Windows 10/11 x64 machine. | `frontend/release/`, `docs/RELEASE_VALIDATION.md` | Clean VM/account; signed test build and hosted models for relevant cases |
| 5 | Complete regression checks and record exact command output and evidence for each verified behavior. | Relevant source/tests and release validation docs | Completion of the focused checks above |

### External release blockers

These can be prepared alongside code-side validation, but must be resolved before public distribution:

1. Produce and review complete corresponding source and third-party materials for the exact GPL-enabled FFmpeg build; publish and attach the reviewed source package.
2. Configure the actual public GitHub repository, publishing access, and a test release; verify update metadata, download, and installation.
3. Provision and verify trusted Windows signing and timestamped artifacts.
4. Provision HTTPS model hosting, publish immutable checkpoint assets, and verify served bytes against registry metadata.
5. Publish only after the applicable redistribution, hosting, signing, and end-to-end validation requirements are satisfied.

## K. Instructions for a fresh Codex session

1. Read `PROJECT_CONTEXT.md`, the relevant docs under `docs/`, and then inspect the live source/config before making changes.
2. Confirm current Git/worktree, dependency, and generated-artifact state; the developer workspace may contain ignored build output and local virtualenv backups.
3. Preserve both original `.pt` checkpoints and working image/video, model-management, update, and LabelImg code. Avoid unnecessary rewrites or unrelated features.
4. Never invent test results, URLs, hashes, model versions, release tags, licensing status, or compatibility claims. Do not call something verified merely because the build passes or the worker starts.
5. Do not modify inference behavior, checkpoint files, distribution behavior, or runtime settings for a documentation-only task.
6. Do not require sample media for unrelated code or documentation work. Use real media only for the focused inference/video checks that need it.
7. Report exact files changed, commands/checks actually executed and their output, and remaining blockers. Keep public release blocked until source, hosting, and signing requirements are genuinely satisfied.
