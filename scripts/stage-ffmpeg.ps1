param(
  [string]$Destination = "src-tauri/resources/bin",
  [string]$SourceDirectory = ""
)

$ErrorActionPreference = "Stop"

function Resolve-BundledBinaryPath([System.Management.Automation.CommandInfo]$command) {
  $commandPath = [System.IO.Path]::GetFullPath($command.Source)
  $fileName = [System.IO.Path]::GetFileName($commandPath)
  $commandDirectory = [System.IO.Path]::GetFileName(
    [System.IO.Path]::GetDirectoryName($commandPath)
  )

  if ($commandDirectory -eq "shims") {
    $scoopRoot = Split-Path -Parent (Split-Path -Parent $commandPath)
    $packageName = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
    $packageCandidates = if ($packageName -in @("ffmpeg", "ffprobe")) {
      @("ffmpeg")
    } else {
      @($packageName)
    }
    foreach ($packageCandidate in $packageCandidates) {
      $scoopCandidate = Join-Path $scoopRoot "apps\$packageCandidate\current\bin\$fileName"
      if (Test-Path -LiteralPath $scoopCandidate -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($scoopCandidate)
      }
    }
  }

  if (Test-Path -LiteralPath $commandPath -PathType Leaf) {
    return $commandPath
  }

  throw "Could not resolve a real executable for $($command.Name)."
}

if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
  $ffmpegCommand = Get-Command ffmpeg -ErrorAction Stop
  $ffprobeCommand = Get-Command ffprobe -ErrorAction Stop
  $ffmpegSource = Resolve-BundledBinaryPath $ffmpegCommand
  $ffprobeSource = Resolve-BundledBinaryPath $ffprobeCommand
} else {
  $resolvedSourceDirectory = if ([System.IO.Path]::IsPathRooted($SourceDirectory)) {
    [System.IO.Path]::GetFullPath($SourceDirectory)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\$SourceDirectory"))
  }
  $ffmpegSource = Join-Path $resolvedSourceDirectory "ffmpeg.exe"
  $ffprobeSource = Join-Path $resolvedSourceDirectory "ffprobe.exe"
  foreach ($source in @($ffmpegSource, $ffprobeSource)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Expected FFmpeg executable was not found: $source"
    }
  }
}

$resolvedTargetDirectory = if ([System.IO.Path]::IsPathRooted($Destination)) {
  [System.IO.Path]::GetFullPath($Destination)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\$Destination"))
}

New-Item -ItemType Directory -Force -Path $resolvedTargetDirectory | Out-Null

$ffmpegTarget = Join-Path $resolvedTargetDirectory "ffmpeg.exe"
$ffprobeTarget = Join-Path $resolvedTargetDirectory "ffprobe.exe"

Copy-Item -LiteralPath $ffmpegSource -Destination $ffmpegTarget -Force
Copy-Item -LiteralPath $ffprobeSource -Destination $ffprobeTarget -Force

Write-Host "Copied ffmpeg from $ffmpegSource to $ffmpegTarget"
Write-Host "Copied ffprobe from $ffprobeSource to $ffprobeTarget"
