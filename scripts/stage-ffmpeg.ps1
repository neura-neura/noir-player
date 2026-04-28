param(
  [string]$Destination = "src-tauri/resources/bin"
)

$ErrorActionPreference = "Stop"

$ffmpegCommand = Get-Command ffmpeg -ErrorAction Stop
$ffprobeCommand = Get-Command ffprobe -ErrorAction Stop

$targetDirectory = Join-Path $PSScriptRoot "..\$Destination"
$resolvedTargetDirectory = [System.IO.Path]::GetFullPath($targetDirectory)

New-Item -ItemType Directory -Force -Path $resolvedTargetDirectory | Out-Null

$ffmpegTarget = Join-Path $resolvedTargetDirectory "ffmpeg.exe"
$ffprobeTarget = Join-Path $resolvedTargetDirectory "ffprobe.exe"

Copy-Item -LiteralPath $ffmpegCommand.Source -Destination $ffmpegTarget -Force
Copy-Item -LiteralPath $ffprobeCommand.Source -Destination $ffprobeTarget -Force

Write-Host "Copied ffmpeg to $ffmpegTarget"
Write-Host "Copied ffprobe to $ffprobeTarget"
