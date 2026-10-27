param([switch]$Publish)

$ErrorActionPreference = 'Stop'

$frontendDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectDir = (Resolve-Path (Join-Path $frontendDir '..')).Path
$python = Join-Path $projectDir 'backend\.venv\Scripts\python.exe'
$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
$buildDir = Join-Path $frontendDir 'build-resources'
$ffmpegDir = Join-Path $buildDir 'ffmpeg'
$modelsDir = Join-Path $buildDir 'models'
$backendDist = Join-Path $projectDir 'backend\dist\boundary-worker'
$workDir = Join-Path $projectDir 'runtime\build\pyinstaller-work'
$specDir = Join-Path $projectDir 'runtime\build\pyinstaller-spec'

function Get-ExecutableOutput([string]$Executable, [string[]]$Arguments) {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = $Arguments -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Could not start executable: $Executable" }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $result = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) { throw "$Executable $($Arguments -join ' ') exited with code $($process.ExitCode). $result" }
  return $result
}

$githubOwner = $env:BOUNDARY_VISION_GITHUB_OWNER
$githubRepo = $env:BOUNDARY_VISION_GITHUB_REPO
if ([bool]$githubOwner -ne [bool]$githubRepo) { throw 'Set both BOUNDARY_VISION_GITHUB_OWNER and BOUNDARY_VISION_GITHUB_REPO, or leave both unset.' }
if ($Publish) {
  if (-not $githubOwner -or -not $githubRepo) { throw 'A GitHub owner and repository are required to publish a release.' }
  if (-not $env:GH_TOKEN) { throw 'GH_TOKEN is required to upload release assets. Do not put it in source files.' }
  if (-not ($env:CSC_LINK -or $env:WIN_CSC_LINK)) { throw 'A Windows code-signing certificate is required for release publishing (set CSC_LINK or WIN_CSC_LINK securely).' }
  if (-not $env:BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE -or -not (Test-Path -LiteralPath $env:BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE -PathType Leaf)) {
    throw 'Publishing is blocked until BOUNDARY_VISION_FFMPEG_SOURCE_ARCHIVE points to the reviewed corresponding-source and third-party source bundle for the bundled GPL FFmpeg build.'
  }
}

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Build Python environment not found: $python. Create backend/.venv and install backend/requirements.txt first."
}
$expectedPython = (Get-Content -LiteralPath (Join-Path $projectDir '.python-version') -Raw).Trim()
$actualPython = (& $python -c 'import platform; print(platform.python_version())').Trim()
if ($actualPython -ne $expectedPython) { throw "Build Python version mismatch: expected $expectedPython from .python-version, found $actualPython." }
if (-not $ffmpegCommand -or -not $ffprobeCommand) { throw 'A matching FFmpeg and FFprobe build must be installed and available on PATH before packaging.' }
$ffmpeg = $ffmpegCommand.Source
$ffprobe = $ffprobeCommand.Source
$ffmpegRoot = Split-Path (Split-Path $ffmpeg)
if ((Split-Path $ffmpeg) -ne (Split-Path $ffprobe)) { throw 'FFmpeg and FFprobe must come from the same bin directory.' }
$ffmpegBanner = Get-ExecutableOutput $ffmpeg @('-version')
$ffprobeBanner = Get-ExecutableOutput $ffprobe @('-version')
$ffmpegVersion = (($ffmpegBanner -split '\r?\n' | Select-Object -First 1) -replace '^ffmpeg version\s+', '' -replace '[^0-9.].*$', '')
$ffprobeVersion = (($ffprobeBanner -split '\r?\n' | Select-Object -First 1) -replace '^ffprobe version\s+', '' -replace '[^0-9.].*$', '')
if (-not $ffmpegVersion -or $ffmpegVersion -ne $ffprobeVersion) { throw "FFmpeg/FFprobe versions do not match ($ffmpegVersion and $ffprobeVersion)." }
$ffmpegDetails = Get-ExecutableOutput $ffmpeg @('-version')
$ffmpegLicense = Get-ExecutableOutput $ffmpeg @('-L')
if ($ffmpegDetails -notmatch '^ffmpeg version 9\.0\.2-full_build-www\.gyan\.dev' -or
    $ffmpegDetails -notmatch '--enable-gpl(?:\s|$)' -or
    $ffmpegDetails -notmatch '--enable-version3(?:\s|$)' -or
    $ffmpegDetails -match '--enable-nonfree(?:\s|$)' -or
    $ffmpegLicense -notmatch 'GNU General Public License[\s\S]*?either version 3') {
  throw 'The FFmpeg binary does not match the reviewed Gyan 9.0.2 GPLv3 build profile. Review docs/WINDOWS_RELEASE.md and update the release license/provenance review before changing this guard.'
}
$ffmpegEncoders = Get-ExecutableOutput $ffmpeg @('-encoders')
if ($ffmpegEncoders -notmatch '\blibx264\b') { throw 'The selected FFmpeg build does not provide the libx264 encoder required by video export.' }
$ffmpegRoot = Split-Path (Split-Path $ffmpeg)
$ffmpegReadme = Join-Path $ffmpegRoot 'README.txt'
$ffmpegReadmeText = if (Test-Path -LiteralPath $ffmpegReadme -PathType Leaf) { Get-Content -LiteralPath $ffmpegReadme -Raw } else { '' }
if ($ffmpegReadmeText -notmatch '9\.0\.2-full_build-www\.gyan\.dev' -or
    $ffmpegReadmeText -notmatch 'GPL v3' -or
    $ffmpegReadmeText -notmatch '946fcce07b' -or
    $ffmpegReadmeText -notmatch 'libx264') {
  throw "The selected FFmpeg build's README/provenance does not match the reviewed binary: $ffmpegReadme"
}

& $python -m pip install --upgrade -r (Join-Path $projectDir 'backend\requirements-release.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked Python release requirements.' }

$previousYoloAutoinstall = $env:YOLO_AUTOINSTALL
$env:YOLO_AUTOINSTALL = 'false'
& $python -m PyInstaller --noconfirm --onedir --name boundary-worker `
  --paths (Join-Path $projectDir 'backend') `
  --distpath (Join-Path $projectDir 'backend\dist') `
  --workpath $workDir --specpath $specDir `
  --collect-all ultralytics --collect-all cv2 `
  --hidden-import app.image_inference --hidden-import app.video_inference `
  (Join-Path $projectDir 'backend\worker_entry.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller could not build the standalone Python worker.' }
if ($null -eq $previousYoloAutoinstall) { Remove-Item Env:YOLO_AUTOINSTALL -ErrorAction SilentlyContinue }
else { $env:YOLO_AUTOINSTALL = $previousYoloAutoinstall }

New-Item -ItemType Directory -Force -Path $ffmpegDir, $modelsDir | Out-Null
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $ffmpegDir 'ffmpeg.exe') -Force
Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $ffmpegDir 'ffprobe.exe') -Force
$licenseFile = Join-Path (Split-Path (Split-Path $ffmpeg)) 'LICENSE'
if (Test-Path -LiteralPath $licenseFile -PathType Leaf) {
  Copy-Item -LiteralPath $licenseFile -Destination (Join-Path $ffmpegDir 'LICENSE.txt') -Force
}
else { throw "FFmpeg license file is missing from build root: $licenseFile" }
$ffmpegReadme = Join-Path $ffmpegRoot 'README.txt'
if (Test-Path -LiteralPath $ffmpegReadme -PathType Leaf) {
  Copy-Item -LiteralPath $ffmpegReadme -Destination (Join-Path $ffmpegDir 'UPSTREAM-README.txt') -Force
}
else { throw "FFmpeg build provenance file is missing from build root: $ffmpegReadme" }

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
      if (-not (Test-Path -LiteralPath $checkpoint -PathType Leaf)) { throw "Model checkpoint missing: $checkpoint" }
      $checkpointInfo = Get-Item -LiteralPath $checkpoint
      $checkpointHash = (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($checkpointInfo.Length -ne $version.expectedSizeBytes -or $checkpointHash -ne $version.sha256) { throw "Registry size/hash does not match original checkpoint: $($model.id) $($version.version)" }
    }
    $version.developmentSource = $null
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
