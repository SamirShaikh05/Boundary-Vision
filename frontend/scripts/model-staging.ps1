function Reset-ModelStagingDirectory {
  param([Parameter(Mandatory)][string]$ProjectDir)

  $projectPath = (Resolve-Path -LiteralPath $ProjectDir).Path
  $frontendPath = Join-Path $projectPath 'frontend'
  $buildResourcesPath = Join-Path $frontendPath 'build-resources'
  $modelsPath = Join-Path $buildResourcesPath 'models'

  foreach ($path in @($buildResourcesPath, $modelsPath)) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to clean model staging through a reparse point: $path"
    }
  }

  if (Test-Path -LiteralPath $modelsPath) {
    $nestedReparsePoints = @(Get-ChildItem -LiteralPath $modelsPath -Recurse -Force |
      Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
      Sort-Object { $_.FullName.Length } -Descending)
    foreach ($entry in $nestedReparsePoints) {
      if ($entry.PSIsContainer) { [System.IO.Directory]::Delete($entry.FullName, $false) }
      else { [System.IO.File]::Delete($entry.FullName) }
    }
    Get-ChildItem -LiteralPath $modelsPath -Force | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Path $modelsPath -Force | Out-Null
  }

  return $modelsPath
}

function Assert-ModelStagingDirectory {
  param([Parameter(Mandatory)][string]$ModelsPath)

  $registryPath = Join-Path $ModelsPath 'registry.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    throw "Model staging is missing the bundled registry: $registryPath"
  }

  $unexpected = @(Get-ChildItem -LiteralPath $ModelsPath -Force | Where-Object { $_.Name -ne 'registry.json' })
  if ($unexpected.Count -gt 0) {
    $names = ($unexpected | ForEach-Object { $_.Name }) -join ', '
    throw "Model staging contains unexpected files or directories: $names"
  }

  $registry = Get-Content -LiteralPath $registryPath -Raw -Encoding utf8 | ConvertFrom-Json
  if ($registry.schemaVersion -ne 2 -or $registry.models.Count -lt 1) {
    throw 'The staged model registry is invalid.'
  }
}
