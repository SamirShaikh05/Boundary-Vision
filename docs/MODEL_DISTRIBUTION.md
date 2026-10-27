# Model distribution and version updates

`models/registry.json` uses schema version 2. A stable `id` identifies the model family; `latestVersion` selects the currently offered version; each `versions[]` entry contains a checkpoint version, format, optional version-specific class mapping (otherwise it inherits the model's classes), exact filename, byte size, SHA-256, Python minimum, and optional URL/development source. Do not reuse a version string for different bytes or metadata. A behavior-changing checkpoint is a new model version and remains an explicit user choice in Model Manager.

## Current entries

Only the already-present `baseline-50-epoch` checkpoints have verified metadata. Their URLs remain null; no newer model version, URL, or checksum has been invented.

| ID | Version | Format | Size | SHA-256 |
|---|---|---|---:|---|
| `yolo26n` | `baseline-50-epoch` | `ultralytics-yolo` | 5,430,469 bytes | `34b16af862199dcf11165e37fd5907ab9bfcd6b29d8e094547851c5265e4c450` |
| `yolo26l` | `baseline-50-epoch` | `ultralytics-yolo` | 52,958,181 bytes | `3c0844e8221b33f30665e7f1c33cccad419301ec5d2de774d66c7bfb3e3f5932` |

The base installer contains only this registry, never a `.pt` checkpoint. Development checkpoints and optional managed versions remain separate from application files. The Model Manager uses storage at `userData/models/{id}/{version}/{filename}`. It also reads the previous unversioned managed path for migration compatibility without moving or deleting it. The selected model ID and version remain in user settings across app updates.

> **Current availability:** Both registry download URLs are null and no model host or immutable hosted assets are configured. Packaged Model Manager downloads are therefore not operational. Local development checkpoint installation is a separate path.

## Adding a hosted model version

1. Publish an immutable checkpoint object to a controlled, public HTTPS origin. A version update uses a new version identifier and a new object key; never replace bytes at a previously published key.
2. Independently download the final served object and calculate its byte size and SHA-256. Have the model owner provide accurate behavior/change notes for the new version; do not derive or guess these values.
3. Add a new `versions[]` item under the existing stable model ID. Set `format` to a runtime-supported value (`ultralytics-yolo` is currently supported), the exact checksums, `minimumPython`, accurate `changeSummary`, and a `downloadUrl` only after hosting is active. Set `latestVersion` to the intended offered version. Keep prior version records so users can continue selecting or removing old installed versions.
4. The package script checks every development checkpoint it is asked to package against its declared size/hash, removes development-source paths from the app registry, and generates URLs for configured versions from `BOUNDARY_VISION_MODEL_BASE_URL` using `/models/{id}/{version}/{filename}`. It does not upload checkpoint assets. Independently verify the resulting registry and public object after building.

`models/hosting.example.json` is an unconfigured example. It is not a live endpoint. No hosting account, destination, credentials, or remote model assets are configured in this repository.

## Installation and activation safety

The user explicitly starts each installation and separately chooses which installed version to use for inference. A download goes to a temporary file under that version's managed directory. The manager checks HTTPS through at most five redirects, caps bytes at the declared size, checks exact final size and SHA-256, then invokes the bundled Python worker to load the staged `.pt` file and verify the registered class order. Only after those checks does it rename the staged file to its versioned destination. Existing versions are kept; installing a new version does not select it or remove an older version. Selection validates the version again before saving `selectedModelId` and `selectedModelVersion`.

Model install/validation is blocked while inference is running; inference cannot start during model installation/validation. Removal is version-specific and refuses the selected version or a version currently used by inference. The registry rejects unsupported model formats and versions that do not meet the bundled Python minimum. If URLs remain unset, the UI says the model source is not configured and no download is attempted.
