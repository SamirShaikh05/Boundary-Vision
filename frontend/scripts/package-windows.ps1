param([switch]$Publish)

$ErrorActionPreference = 'Stop'

$frontendDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectDir = (Resolve-Path (Join-Path $frontendDir '..')).Path
$python = Join-Path $projectDir 'backend\.venv\Scripts\python.exe'
$buildDir = Join-Path $frontendDir 'build-resources'
$modelsDir = Join-Path $buildDir 'models'
$backendDist = Join-Path $projectDir 'backend\dist\boundary-worker'
$workDir = Join-Path $projectDir 'runtime\build\pyinstaller-work'
$specDir = Join-Path $projectDir 'runtime\build\pyinstaller-spec'
. (Join-Path $PSScriptRoot 'model-staging.ps1')
$modelsDir = Reset-ModelStagingDirectory -ProjectDir $projectDir

$githubOwner = $env:BOUNDARY_VISION_GITHUB_OWNER
$githubRepo = $env:BOUNDARY_VISION_GITHUB_REPO
if ([bool]$githubOwner -ne [bool]$githubRepo) { throw 'Set both BOUNDARY_VISION_GITHUB_OWNER and BOUNDARY_VISION_GITHUB_REPO, or leave both unset.' }
if ($Publish) {
  if (-not $githubOwner -or -not $githubRepo) { throw 'A GitHub owner and repository are required to publish a release.' }
  if (-not $env:GH_TOKEN) { throw 'GH_TOKEN is required to upload release assets. Do not put it in source files.' }
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Build Python environment not found: $python. Create backend/.venv and install backend/requirements.txt first."
}
$expectedPython = (Get-Content -LiteralPath (Join-Path $projectDir '.python-version') -Raw).Trim()
$actualPython = (& $python -c 'import platform; print(platform.python_version())').Trim()
if ($actualPython -ne $expectedPython) { throw "Build Python version mismatch: expected $expectedPython from .python-version, found $actualPython." }
& $python -m pip install -r (Join-Path $projectDir 'backend\requirements-release.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked Python release requirements.' }

$previousYoloAutoinstall = $env:YOLO_AUTOINSTALL
$env:YOLO_AUTOINSTALL = 'false'
& $python -m PyInstaller --noconfirm --onedir --name boundary-worker `
  --paths (Join-Path $projectDir 'backend') `
  --distpath (Join-Path $projectDir 'backend\dist') `
  --workpath $workDir --specpath $specDir `
  --collect-all ultralytics --collect-all cv2 --collect-all torchvision `
  --hidden-import app.image_inference --hidden-import app.video_inference `
  (Join-Path $projectDir 'backend\worker_entry.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller could not build the standalone Python worker.' }
if ($null -eq $previousYoloAutoinstall) { Remove-Item Env:YOLO_AUTOINSTALL -ErrorAction SilentlyContinue }
else { $env:YOLO_AUTOINSTALL = $previousYoloAutoinstall }
if (-not (Test-Path -LiteralPath (Join-Path $backendDist 'boundary-worker.exe') -PathType Leaf)) {
  throw "PyInstaller output is missing the expected worker: $(Join-Path $backendDist 'boundary-worker.exe')"
}

$registryPath = Join-Path $projectDir 'models\registry.json'
$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($registry.schemaVersion -ne 2 -or $registry.models.Count -lt 1) { throw 'The model registry schema is invalid.' }
$modelBaseUrl = $env:BOUNDARY_VISION_MODEL_BASE_URL
if ($modelBaseUrl) {
  $baseUri = $null
  if (-not [Uri]::TryCreate($modelBaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment) {
    throw 'BOUNDARY_VISION_MODEL_BASE_URL must be an HTTPS base URL without credentials, query, or fragment.'
  }
  $modelBaseUrl = $modelBaseUrl.TrimEnd('/')
}
$seenModelIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($model in $registry.models) {
  if ($model.id -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$' -or -not $seenModelIds.Add($model.id)) { throw "Model registry ID is invalid or duplicated: $($model.id)" }
  if ($model.classes.Count -lt 1 -or @($model.classes | Select-Object -Unique).Count -ne $model.classes.Count) { throw "Model class list is invalid: $($model.id)" }
  if (-not $model.versions -or -not @($model.versions | Where-Object { $_.version -eq $model.latestVersion })) { throw "Latest model version metadata is missing: $($model.id)" }
  foreach ($version in $model.versions) {
    if ($version.version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw "Model version is invalid: $($model.id)" }
    if ($version.checkpointFilename -notmatch '^[A-Za-z0-9._-]+\.pt$' -or $version.sha256 -notmatch '^[a-f0-9]{64}$' -or $version.expectedSizeBytes -lt 1) { throw "Model file metadata is invalid: $($model.id) $($version.version)" }
    if ($version.classes -and ($version.classes.Count -lt 1 -or @($version.classes | Select-Object -Unique).Count -ne $version.classes.Count)) { throw "Model version class list is invalid: $($model.id) $($version.version)" }
    if ($version.developmentSource) {
      $checkpoint = Join-Path (Join-Path $projectDir 'models') $version.developmentSource
      if (Test-Path -LiteralPath $checkpoint -PathType Leaf) {
        $checkpointInfo = Get-Item -LiteralPath $checkpoint
        $checkpointHash = (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($checkpointInfo.Length -ne $version.expectedSizeBytes -or $checkpointHash -ne $version.sha256) { throw "Registry size/hash does not match local checkpoint: $($model.id) $($version.version)" }
      } else {
        Write-Host "Optional development checkpoint not present; packaging the registry without model weights: $checkpoint"
      }
    }
    $version.developmentSource = $null
    $version.PSObject.Properties.Remove('minimumPython')
    if ($modelBaseUrl) {
      $version.downloadUrl = "$modelBaseUrl/models/$([Uri]::EscapeDataString($model.id))/$([Uri]::EscapeDataString($version.version))/$([Uri]::EscapeDataString($version.checkpointFilename))"
    } elseif ($version.downloadUrl) {
      $assetUri = $null
      if (-not [Uri]::TryCreate($version.downloadUrl, [UriKind]::Absolute, [ref]$assetUri) -or $assetUri.Scheme -ne 'https' -or $assetUri.UserInfo) { throw "Model asset URL must be HTTPS without credentials: $($model.id) $($version.version)" }
    }
  }
}
$registryJson = $registry | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText((Join-Path $modelsDir 'registry.json'), $registryJson, [System.Text.UTF8Encoding]::new($false))
Assert-ModelStagingDirectory -ModelsPath $modelsDir

Push-Location $frontendDir
try {
  $publishMode = if ($Publish) { 'always' } else { 'never' }
  $builderArgs = @('--win', 'nsis', '--x64', '--publish', $publishMode)
  if ($githubOwner) { $builderArgs += @('--config', 'electron-builder.config.cjs') }
  & .\node_modules\.bin\electron-builder.cmd @builderArgs
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder could not create the Windows installer.' }
} finally {
  Pop-Location
}

Write-Host "Windows installer created in $(Join-Path $frontendDir 'release')."
