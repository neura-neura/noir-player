param(
  [switch]$VerifyOnly,
  [string]$FfmpegDirectory = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $PSScriptRoot "native-runtime-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ($manifest.schemaVersion -ne 1 -or $manifest.target -ne "windows-x86_64") {
  throw "Unsupported native runtime manifest: $manifestPath"
}

if (-not $VerifyOnly) {
  Push-Location $repoRoot
  try {
    Write-Host "Preparing libmpv DLLs with tauri-plugin-libmpv-api..."
    & npx --yes tauri-plugin-libmpv-api setup-lib
    if ($LASTEXITCODE -ne 0) {
      throw "libmpv setup failed with exit code $LASTEXITCODE."
    }

    $stageScript = Join-Path $repoRoot "scripts/stage-ffmpeg.ps1"
    $stageArguments = @(
      "-ExecutionPolicy", "Bypass",
      "-File", $stageScript
    )
    if (-not [string]::IsNullOrWhiteSpace($FfmpegDirectory)) {
      $stageArguments += @("-SourceDirectory", $FfmpegDirectory)
    }

    Write-Host "Staging FFmpeg/FFprobe..."
    & powershell @stageArguments
    if ($LASTEXITCODE -ne 0) {
      throw "FFmpeg staging failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

foreach ($artifact in $manifest.artifacts) {
  $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $artifact.path))
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Native runtime artifact is missing: $artifact.path`nRun scripts/stage-native-runtime.ps1 to stage it."
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToUpperInvariant()
  $expectedHash = ([string]$artifact.sha256).ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "SHA-256 mismatch for $artifact.path. Expected $expectedHash, got $actualHash."
  }

  Write-Host "Verified $($artifact.path) [$($artifact.version)]"
}

Write-Host "Native runtime is staged and matches $manifestPath."
