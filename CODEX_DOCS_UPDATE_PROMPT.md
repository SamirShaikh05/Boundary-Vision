# Codex task: reconcile Boundary Vision Markdown documentation

Read `PROJECT_CONTEXT.md`, `README.md`, and every Markdown file under `docs/`. Update the documentation in the repository so it is consistent, precise, and honest about the current state.

## Ground rules

- Treat source code and actual command/test output as the authority. Do not invent repository details, URLs, release assets, test results, metrics, hashes, or legal conclusions.
- Keep the two supported model families explicit: YOLO26n (lightweight) and YOLO26l (larger). Do not describe the product as YOLO26l-only.
- Preserve the original checkpoint files unchanged.
- Do not change application source code, model files, registry data, dependencies, or packaging behavior as part of this documentation-only task.
- Do not claim a feature is verified end to end merely because code exists, a build passes, or the worker capability handshake succeeds.
- If a current source file or command contradicts the documentation, inspect it and update the documentation to the verified state. Mark unknowns as unknown.
- Do not publish releases, download/upload model assets, or use credentials.

## Required consistency across the Markdown files

1. **Product scope:** Windows desktop app; Electron/React/TypeScript/Vite UI; local Python inference worker; FFmpeg/FFprobe video processing; local inference with no required cloud inference service.
2. **Models:** YOLO26n and YOLO26l; class IDs `0: Bat`, `1: Ball`, `2: Stump`; original development checkpoints remain unchanged. The base installer excludes checkpoints. The current registry has no active hosted download URLs, so packaged Model Manager downloads are not operational.
3. **Development versus packaged Python:** document the exact versions from `.nvmrc` and `.python-version`. Explain that development requires the configured `backend/.venv`, while the packaged app is intended to include its own Python runtime. Do not imply that users need to install Python for the packaged app unless verified otherwise.
4. **Feature status:** distinguish code-present, build-checked, smoke-tested, and end-to-end verified. Explicitly state that actual inference with both checkpoints, model-powered video processing, real VFR end-to-end behavior, annotation correctness, cancellation cleanup, LabelImg launch/round-trip, live updates, remote model installation, and clean-machine testing remain unverified unless new evidence exists.
5. **Distribution blockers:** unsigned installer/binaries; missing real GitHub owner/repository/feed and published update test; no hosted immutable model assets; FFmpeg GPL-enabled build's complete corresponding source/third-party materials and review not yet complete. Do not call a source archive compliant merely because a path exists.
6. **Installer readiness:** state prominently that the current installer is not ready for public distribution until applicable source/licensing, signing, hosting, and validation requirements are resolved.
7. **No fabricated commands or links:** only include release commands supported by the repository, and explain required environment variables without inserting fake values or URLs.
8. **Roadmap:** prioritize real image inference with both models, then video/VFR and annotation/cancellation validation, then LabelImg round-trip and clean-machine installation. Keep external release blockers explicit and separate from code-side testing.
9. **Links and formatting:** repair broken relative links, use standard Markdown headings (for example `# Title`, not `**# Title**`), and ensure code blocks, tables, and inline code render correctly.

## Files to inspect/update

- `README.md`
- `PROJECT_CONTEXT.md`
- `docs/APP_UPDATES.md`
- `docs/LABELIMG.md`
- `docs/MODEL_DISTRIBUTION.md`
- `docs/RELEASE_VALIDATION.md`
- `docs/WINDOWS_RELEASE.md`

Only change files that need changes. Avoid duplicating the entire engineering handover into every document; keep README user-facing, `PROJECT_CONTEXT.md` as the detailed handover, and each `docs/` file focused on its subject.

## Validation and final report

- Check relative Markdown links and heading/code-block formatting.
- Compare claims against source/config and existing test evidence.
- If available, run the repository's existing Markdown/link check; do not add dependencies solely for this task.
- Report each file changed, the key corrections, checks actually run, and any claims you could not verify.
