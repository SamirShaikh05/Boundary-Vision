# Contributing to Boundary Vision

Welcome, and thank you for considering a contribution to Boundary Vision! Contributions from developers, students, researchers, and future interns are welcome. Bug reports, thoughtful feature proposals, documentation improvements, application changes, and carefully evaluated model proposals all help the project.

Before starting substantial work, open or join a GitHub issue to discuss the proposed change. This helps establish scope and avoid duplicated effort. For model-related changes, read [AI model contributions](#ai-model-contributions) and [Model distribution and large files](#model-distribution-and-large-files) before preparing files.

## Project overview and architecture

Boundary Vision is a Windows desktop application for local cricket object detection. The application is built with Electron, React, TypeScript, and Vite. Electron's main process and preload layer provide desktop integration and communicate with a local Python worker. The worker uses Ultralytics YOLO, PyTorch, and OpenCV for image and video inference. FFmpeg and FFprobe are downloaded on demand for video processing; they are not bundled with the application. The supported detection classes are **Bat**, **Ball**, and **Stump**.

Model Manager reads model metadata from a remote registry, with a bundled-registry fallback, and installs compatible weights into per-user application storage. Model weights are distributed separately from the source repository through GitHub Releases. The app also supports batch image processing, video processing, YOLO TXT / Pascal VOC XML / CreateML annotation exports, and optional LabelImg integration.

## Prerequisites

The documented development setup is for **Windows x64**:

- Git.
- Node.js `26.11.1`, specified in the root [`.nvmrc`](./.nvmrc), with npm `11.20.0` as specified by `frontend/package.json`.
- Python `3.15.2`, specified in [`.python-version`](./.python-version), and the Python launcher (`py`).
- Network access to install dependencies and, if desired, download model weights.

Packaged users do not need to install Python for inference. LabelImg is an optional, separately installed tool with its own Python environment. Other platforms may need different setup steps; this repository does not document them as supported development targets.

## Get the source and install dependencies

1. Fork [Boundary Vision](https://github.com/SamirShaikh05/Boundary-Vision) on GitHub.
2. Clone your fork and enter the project directory. Replace `YOUR_GITHUB_USERNAME` with your GitHub account name:

   ```powershell
   git clone https://github.com/YOUR_GITHUB_USERNAME/Boundary-Vision.git
   cd Boundary-Vision
   ```

3. Install and select the Node.js version from the root `.nvmrc` (these commands use nvm-windows):

   ```powershell
   nvm install 26.11.1
   nvm use 26.11.1
   ```

4. Create and activate the backend development environment, then install the developer requirements:

   ```powershell
   cd backend
   py -3.15 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   $env:PYYAML_FORCE_LIBYAML = "0"
   python -m pip install --upgrade -r requirements.txt
   Remove-Item Env:PYYAML_FORCE_LIBYAML
   ```

5. Install the frontend dependencies from the lockfile:

   ```powershell
   cd ..\frontend
   npm ci
   ```

`backend/requirements.txt` is intentionally unpinned for development. The separate `requirements-release.txt` is for the Windows release worker build, not the normal development setup. Do not commit virtual environments, generated output, credentials, or downloaded model checkpoints.

## Run the application

From `frontend/`, run:

```powershell
npm run dev
```

This starts the Vite development server and Electron application. Electron starts the Python worker when needed; there is no separate backend server to start. The worker uses `backend/.venv`. For detailed behavior and the documented setup commands, see the README's [developer section](./README.md#for-developers).

## Run tests and checks

Run the frontend build and frontend tests from `frontend/`:

```powershell
npm run build
npm run test:workflow
npm run test:updates
npm run test:staging
```

The workflow tests import generated Electron output, so run `npm run build` first. The three test commands are defined in `frontend/package.json`.

Run the Python unit tests from `backend/` with the development environment activated:

```powershell
python -m unittest discover -s tests
```

`backend/tests/test_models.py` is a manual checkpoint-loading diagnostic, not an automated unit test. From `backend/`, run it with `python tests/test_models.py` if you have downloaded the local checkpoint files; those files are not included in a normal clone. There is no separate lint or formatting command configured in the frontend or backend manifests. Before opening a pull request, run the checks relevant to your change and report any unavailable test or external dependency clearly.

## Branches and commits

Create a focused branch from the current `main` branch:

```powershell
git switch main
git pull origin main
git switch -c feature/feature-name
```

Suggested branch prefixes:

- `feature/feature-name`
- `fix/bug-name`
- `docs/documentation-name`
- `refactor/component-name`
- `model/model-name`

Use lowercase, descriptive names with hyphens. Keep each branch focused on one related change.

Use a concise commit message in the Conventional Commits style. This is a project recommendation, not an automated repository rule:

- `feat: add confidence threshold preset`
- `fix: preserve existing annotation files`
- `docs: clarify model contribution workflow`
- `test: cover batch export collisions`
- `refactor: isolate model registry validation`

## Contribution areas

### Application contributions

Useful application work includes:

- **Electron and desktop functionality:** main/preload process, native dialogs, settings, application updates, and Windows integration.
- **React and TypeScript frontend:** screens, accessibility, interaction design, and consistent UI behavior.
- **Python inference worker:** request handling, model loading, image/video inference, and validation.
- **Image and batch processing:** reliable processing, cancellation, output naming, and resource use.
- **Video and FFmpeg integration:** decoding, timing, encoding, progress, and failure handling.
- **Model Manager:** registry compatibility, checkpoint validation, install/update/remove behavior, and clear errors.
- **Annotation exports:** YOLO TXT, Pascal VOC XML, and CreateML output correctness.
- **LabelImg integration:** configuration, launch behavior, and image-result dataset export.
- **Testing, performance, documentation, and bug fixes** across the application.

Please check existing behavior and related documentation before proposing a change. Avoid changing or replacing model weights or other generated/external assets as part of an unrelated application pull request.

### AI model contributions

Model contributions are important to Boundary Vision. This section describes how to propose cricket object detection model improvements while keeping the distinction clear between existing application behavior and contributor steps that are **proposed for review**.

1. **Use the supported classes.** The current order is class ID `0` = Bat, `1` = Ball, and `2` = Stump. Keep the names and IDs consistent throughout annotations, training configuration, validation, and proposed registry metadata.
2. **Prepare or extend an appropriately annotated dataset.** Describe the data sources, split strategy, class counts, annotation process, and any relevant representativeness or data-quality concerns. Do not include private, restricted, or unlicensed data.
3. **Use consistent annotations and class mappings.** Record the annotation format and any conversions. Boundary Vision can export YOLO TXT, Pascal VOC XML, and CreateML JSON annotations; those export capabilities do not constitute a training pipeline.
4. **Train a YOLO model using a compatible workflow.** The repository contains inference code, not an automated training pipeline or prescribed training command. Contributors should document the actual external tools, versions, and commands they used rather than imply those tools are part of Boundary Vision.
5. **Evaluate on held-out validation data and test images.** Report the dataset split and relevant metrics (for example precision, recall, and mAP), including per-class results where available. Explain how qualitative test images were selected and evaluated.
6. **Report results and limitations.** Include failure cases, class imbalance, data coverage, resource needs, and any known bias or generalization limitations. Do not claim accuracy or compatibility without evidence.
7. **Submit a proposal for review.** Open an issue or pull request with the model information below. A proposal is not an approval, model release, or registry update.
8. **Have compatibility evaluated before integration.** Maintainers must review whether the checkpoint can be represented in the registry and loaded by Boundary Vision. The current Model Manager supports the `ultralytics-yolo` format; the worker must load the checkpoint and validate the expected class names/order. Successful loading alone does not demonstrate useful detection quality.

A model proposal should include:

- Model architecture, family, and version.
- Training dataset description, sources, and train/validation/test split.
- Dataset licensing and explicit usage/distribution permissions.
- Exact class mapping and annotation conventions.
- Training configuration and relevant tool/library versions.
- Validation dataset details, evaluation method, and per-class/overall metrics.
- Representative test results and known limitations.
- Checkpoint format, file size, SHA-256, runtime/library compatibility, and any other information needed to evaluate integration.

Do not upload dataset contents, checkpoints, or other materials unless you have the rights to share them and maintainers have agreed on a suitable submission method. A model PR should focus on a proposal and its review evidence; it does not by itself authorize a checkpoint to be published or selected by the application.

### Model distribution and large files

The application currently fetches model metadata from a remote registry and falls back to the bundled registry when needed. The current registry declares the `ultralytics-yolo` format, supported classes, checkpoint filename, exact expected size, SHA-256, and download URL. Model Manager verifies the downloaded file's size and hash, then asks the Python worker to load and validate its classes before installation. The existing model weights are distributed through the project's GitHub Releases; `.pt` checkpoints are not tracked in the Git repository.

**Do not simply commit large `.pt` checkpoint files to the repository.** The following is the proposed contributor/maintainer review workflow, not an existing model submission API or automated training/release pipeline:

1. Discuss the model proposal and its evidence with maintainers through an issue or pull request.
2. Provide the required model metadata and compatibility information in the proposal. Maintainers review the dataset rights, evaluation, checkpoint format, and class mapping.
3. If the proposal is accepted for integration, coordinate a compatibility test using Boundary Vision's actual worker and Model Manager requirements.
4. Only after approval, coordinate hosting approved weights through a GitHub Release or the project's established model distribution mechanism. Calculate and independently verify the final hosted file's exact size and SHA-256.
5. A maintainer can then review a separate registry metadata change with the new immutable version, supported format, exact classes, verified file size/hash, and active HTTPS download URL. Existing versions should not be silently replaced.

Contributors should not assume they can publish to the project's Releases or alter its remote registry. No public model upload endpoint, automated model evaluation service, or contributor-operated integration process is currently implemented. A model proposal may be reviewed without being accepted or distributed.

## Before opening a pull request

- Make a focused change and rebase or update it against the current `main` branch.
- Run the relevant frontend build/tests and/or Python unit tests described above.
- Check for unintended generated files, secrets, personal data, unlicensed datasets, or large model files.
- Update documentation affected by the change.
- For model-related proposals, include the requested model metadata, evaluation results, dataset permissions, and limitations; distinguish measured results from estimates.
- Provide clear reproduction steps for fixes and screenshots or recordings for visible UI changes where useful.
- Complete the pull request template and explain any checks you could not run.

## Pull request review and merging

Open a pull request from your fork's focused branch to the repository's `main` branch. Describe the problem, solution, scope, tests, and any compatibility impact. Link a related issue when available. Maintainers may ask questions, request revisions, or additional validation. Please respond to review feedback and update the pull request rather than opening duplicate submissions.

Maintainers decide when a change is ready and whether to merge it. A pull request does not guarantee acceptance, release timing, or inclusion in a model registry or hosted release. There is no automated training approval or model publication process.

## Licensing and third-party materials

The root [MIT License](./LICENSE) applies to Boundary Vision project materials that the project is entitled to license. It does **not** automatically relicense third-party packages, model weights, training datasets, annotation data, or external tools/assets. Before contributing material, confirm that you have the right to share it and identify its applicable license and attribution requirements. Record dataset and model permissions in model proposals; do not submit material with unclear or incompatible rights.

The license and redistribution terms for dependencies, existing YOLO checkpoint weights, their training data, and external assets have not all been independently verified as part of this contribution guide. These items require manual licensing review before redistribution or other use. See also the project [Code of Conduct](./CODE_OF_CONDUCT.md).
