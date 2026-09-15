param()

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $PSScriptRoot "native-runtime-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ($manifest.schemaVersion -ne 1 -or $manifest.target -ne "windows-x86_64") {
  throw "Unsupported native runtime manifest: $manifestPath"
}

# setup-lib intentionally follows upstream latest assets. Release builds use
# these versioned release assets instead, so a later upstream build cannot
# silently invalidate the manifest's pinned SHA-256 values.
$wrapperUrl = "https://github.com/nini22P/libmpv-wrapper/releases/download/v0.1.1/libmpv-wrapper-windows-x86_64.zip"
$wrapperSha256 = "D2FF8B2EDCD34D2968E544ADAA915E5E5C48EB1A0995945005269C2AF119A492"
# The upstream daily build was removed. Our published installer contains the
# identical DLL, independently checked against native-runtime-manifest.json.
$mpvUrl = "https://github.com/neura-neura/noir-player/releases/download/v0.1.16/Noir.Player_0.1.16_x64-setup.exe"
$mpvSha256 = "F4A82A27FF8C69EFAB4A3F2FBE7C1234398E100A96FCE253CF5F35DBB73CF7DD"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("noir-libmpv-" + [guid]::NewGuid().ToString("N"))
$wrapperArchive = Join-Path $tempRoot "libmpv-wrapper.zip"
$mpvArchive = Join-Path $tempRoot "noir-runtime-source.exe"
$wrapperExtract = Join-Path $tempRoot "wrapper"
$mpvExtract = Join-Path $tempRoot "mpv"
$targetDirectory = Join-Path $repoRoot "src-tauri/lib"

function DownloadAndVerify([string]$url, [string]$destination, [string]$expectedHash) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Write-Host "Downloading pinned native archive $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($destination)
    try {
      $actualHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToUpperInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha.Dispose()
  }
  if ($actualHash -ne $expectedHash) {
    throw "SHA-256 mismatch for $url. Expected $expectedHash, got $actualHash."
  }
}

function ExtractArchive([string]$archive, [string]$destination) {
  $sevenZip = Get-Command 7z.exe -ErrorAction Stop
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  & $sevenZip.Source x $archive "-o$destination" "-y"
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip failed to extract $archive with exit code $LASTEXITCODE."
  }
}

try {
  New-Item -ItemType Directory -Force -Path $tempRoot,$targetDirectory | Out-Null

  DownloadAndVerify $wrapperUrl $wrapperArchive $wrapperSha256
  ExtractArchive $wrapperArchive $wrapperExtract
  $wrapperDll = Get-ChildItem -LiteralPath $wrapperExtract -Recurse -Filter "libmpv-wrapper.dll" |
    Select-Object -First 1
  if ($null -eq $wrapperDll) {
    throw "Pinned wrapper archive did not contain libmpv-wrapper.dll."
  }
  Copy-Item -LiteralPath $wrapperDll.FullName -Destination (Join-Path $targetDirectory "libmpv-wrapper.dll") -Force

  DownloadAndVerify $mpvUrl $mpvArchive $mpvSha256
  ExtractArchive $mpvArchive $mpvExtract
  $mpvDll = Get-ChildItem -LiteralPath $mpvExtract -Recurse -Filter "libmpv-2.dll" |
    Select-Object -First 1
  if ($null -eq $mpvDll) {
    throw "Pinned mpv archive did not contain libmpv-2.dll."
  }
  Copy-Item -LiteralPath $mpvDll.FullName -Destination (Join-Path $targetDirectory "libmpv-2.dll") -Force

  Write-Host "Pinned libmpv runtime staged; run stage-native-runtime.ps1 -VerifyOnly next."
} finally {
  if ([System.IO.Directory]::Exists($tempRoot)) {
    [System.IO.Directory]::Delete($tempRoot, $true)
  }
}
