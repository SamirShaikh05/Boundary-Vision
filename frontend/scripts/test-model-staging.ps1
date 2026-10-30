$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'model-staging.ps1')

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('boundary-vision-staging-test-' + [guid]::NewGuid().ToString('N'))
$projectDir = Join-Path $testRoot 'project'
$modelsPath = Join-Path $projectDir 'frontend\build-resources\models'

try {
  New-Item -ItemType Directory -Path $modelsPath -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $modelsPath 'old-registry.json') -Value '{}'
  Set-Content -LiteralPath (Join-Path $modelsPath 'stale.pt') -Value 'stale model bytes'
  Set-Content -LiteralPath (Join-Path $modelsPath 'stale.onnx') -Value 'stale binary'
  New-Item -ItemType Directory -Path (Join-Path $modelsPath 'old-build') | Out-Null
  Set-Content -LiteralPath (Join-Path $modelsPath 'old-build\artifact.bin') -Value 'stale artifact'
  $externalDirectory = Join-Path $testRoot 'outside-staging'
  New-Item -ItemType Directory -Path $externalDirectory -Force | Out-Null
  $externalMarker = Join-Path $externalDirectory 'keep.txt'
  Set-Content -LiteralPath $externalMarker -Value 'outside staging'
  New-Item -ItemType Junction -Path (Join-Path $modelsPath 'stale-junction') -Target $externalDirectory | Out-Null

  $resetPath = Reset-ModelStagingDirectory -ProjectDir $projectDir
  if ($resetPath -ne $modelsPath) { throw "Unexpected staging path: $resetPath" }
  if (@(Get-ChildItem -LiteralPath $resetPath -Force).Count -ne 0) { throw 'Reset left stale model staging content behind.' }
  if (-not (Test-Path -LiteralPath $externalMarker -PathType Leaf)) { throw 'Reset touched content outside the generated staging directory.' }

  $registry = @{ schemaVersion = 2; models = @(@{ id = 'fixture'; versions = @() }) } | ConvertTo-Json -Depth 10
  Set-Content -LiteralPath (Join-Path $resetPath 'registry.json') -Value $registry -Encoding utf8
  Assert-ModelStagingDirectory -ModelsPath $resetPath

  Set-Content -LiteralPath (Join-Path $resetPath 'unexpected.pt') -Value 'forbidden'
  try { Assert-ModelStagingDirectory -ModelsPath $resetPath; throw 'Validation accepted an unexpected .pt file.' }
  catch { if ($_.Exception.Message -notmatch 'unexpected files or directories') { throw } }
  Remove-Item -LiteralPath (Join-Path $resetPath 'unexpected.pt') -Force

  Set-Content -LiteralPath (Join-Path $resetPath 'unexpected.dll') -Value 'forbidden'
  try { Assert-ModelStagingDirectory -ModelsPath $resetPath; throw 'Validation accepted an unexpected binary.' }
  catch { if ($_.Exception.Message -notmatch 'unexpected files or directories') { throw } }
  Write-Output 'Model staging cleanup and validation tests passed.'
} finally {
  if (Test-Path -LiteralPath $testRoot) { [System.IO.Directory]::Delete($testRoot, $true) }
}
