param(
  [string]$MiraRepo = "",
  [string]$MiraUiRepo = "",
  [string]$WinSwVersion = "v3.0.0-alpha.11",
  [switch]$RecreateVenv,
  [switch]$SkipEngineBuild,
  [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RepoPath {
  param(
    [string]$Path,
    [string]$DefaultPath,
    [string]$Name
  )

  $candidate = if ($Path) { $Path } else { $DefaultPath }
  if (-not (Test-Path $candidate)) {
    throw "$Name path does not exist: $candidate"
  }
  return (Resolve-Path $candidate).Path
}

function Assert-LocalWindowsPath {
  param(
    [string]$Path,
    [string]$Name
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith("\\psf\", [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith("C:\Mac\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name is under a Parallels shared folder ($fullPath). Move the repo to a local Windows path such as C:\Users\$env:USERNAME\Code."
  }
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Get-CommandPath {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found on PATH: $Name"
  }
  return $command.Source
}

function Install-Arm64Uv {
  param([string]$MiraRepo)

  $assetName = "uv-aarch64-pc-windows-msvc.zip"
  $baseUrl = "https://github.com/astral-sh/uv/releases/latest/download"
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "mira-win-arm64-uv-$([System.Guid]::NewGuid().ToString('N'))"
  $zipPath = Join-Path $tempDir $assetName
  $shaPath = Join-Path $tempDir "$assetName.sha256"
  $extractDir = Join-Path $tempDir "uv"
  $bundledDir = Join-Path $MiraRepo "bundled"
  $destPath = Join-Path $bundledDir "uv.exe"

  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  try {
    Invoke-Checked -FilePath "curl.exe" -Arguments @("-f", "-L", "-o", $zipPath, "$baseUrl/$assetName") -WorkingDirectory $MiraRepo
    Invoke-Checked -FilePath "curl.exe" -Arguments @("-f", "-L", "-o", $shaPath, "$baseUrl/$assetName.sha256") -WorkingDirectory $MiraRepo

    $expected = ((Get-Content $shaPath -TotalCount 1).Trim() -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      throw "uv sha256 mismatch. Expected $expected, got $actual."
    }

    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $uvExe = Get-ChildItem -Path $extractDir -Recurse -Filter "uv.exe" | Select-Object -First 1
    if (-not $uvExe) {
      throw "uv.exe was not found inside $zipPath"
    }

    New-Item -ItemType Directory -Force -Path $bundledDir | Out-Null
    Copy-Item -Force $uvExe.FullName $destPath
    Write-Host "Bundled ARM64 uv: $destPath" -ForegroundColor Green
  } finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "This script must run on Windows ARM64."
}

if ($env:PROCESSOR_ARCHITECTURE -ne "ARM64") {
  throw "This PowerShell process is $env:PROCESSOR_ARCHITECTURE, not ARM64. Open ARM64 PowerShell/Terminal and run the script again."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultMiraUiRepo = Join-Path $scriptDir ".."
$defaultMiraRepo = Join-Path $scriptDir "..\..\mira"

$MiraUiRepo = Resolve-RepoPath -Path $MiraUiRepo -DefaultPath $defaultMiraUiRepo -Name "mira-ui repo"
$MiraRepo = Resolve-RepoPath -Path $MiraRepo -DefaultPath $defaultMiraRepo -Name "mira repo"

Assert-LocalWindowsPath -Path $MiraUiRepo -Name "mira-ui repo"
Assert-LocalWindowsPath -Path $MiraRepo -Name "mira repo"

$nodePath = Get-CommandPath "node.exe"
$npmPath = Get-CommandPath "npm.cmd"
$nodeArch = (& $nodePath -p "process.arch").Trim()
if ($nodeArch -ne "arm64") {
  throw "Node is '$nodeArch', not 'arm64'. Install the Windows ARM64 Node.js build and ensure it is first on PATH."
}

if (-not $SkipEngineBuild) {
  $venvPython = Join-Path $MiraRepo ".venv\Scripts\python.exe"
  $venvDir = Join-Path $MiraRepo ".venv"

  if ($RecreateVenv -and (Test-Path $venvDir)) {
    Remove-Item -Recurse -Force $venvDir
  }

  if (-not (Test-Path $venvPython)) {
    Invoke-Checked -FilePath "py.exe" -Arguments @("-3.11", "-m", "venv", ".venv") -WorkingDirectory $MiraRepo
  }

  $pythonInfo = (& $venvPython -c "import platform, sys; print(f'{sys.version_info.major}.{sys.version_info.minor};{platform.machine().lower()}')").Trim()
  $pythonParts = $pythonInfo.Split(";")
  if ($pythonParts[0] -ne "3.11" -or $pythonParts[1] -notin @("arm64", "aarch64")) {
    throw "Expected ARM64 Python 3.11 venv, got '$pythonInfo'. Install ARM64 Python 3.11 and rerun with -RecreateVenv."
  }

  Invoke-Checked -FilePath $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip") -WorkingDirectory $MiraRepo
  Invoke-Checked -FilePath $venvPython -Arguments @("-m", "pip", "install", "-e", ".") -WorkingDirectory $MiraRepo
  Invoke-Checked -FilePath $venvPython -Arguments @("-m", "pip", "install", "pytest", "pytest-asyncio", "pytest-cov", "aiohttp", "ruff", "build", "pyinstaller") -WorkingDirectory $MiraRepo
  Install-Arm64Uv -MiraRepo $MiraRepo

  $pyInstaller = Join-Path $MiraRepo ".venv\Scripts\pyinstaller.exe"
  Invoke-Checked -FilePath $pyInstaller -Arguments @("--clean", "mira-engine.spec") -WorkingDirectory $MiraRepo
}

$engineExe = Join-Path $MiraRepo "dist\mira-engine.exe"
if (-not (Test-Path $engineExe)) {
  throw "mira-engine.exe was not found: $engineExe"
}

$downloadsDir = Join-Path $env:USERPROFILE "Downloads"
$winSwExe = Join-Path $downloadsDir "WinSW-arm64.exe"
if (-not (Test-Path $winSwExe)) {
  New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
  $winSwUrl = "https://github.com/winsw/winsw/releases/download/$WinSwVersion/WinSW-arm64.exe"
  Invoke-Checked -FilePath "curl.exe" -Arguments @("-f", "-L", "-o", $winSwExe, $winSwUrl) -WorkingDirectory $MiraUiRepo
}

if (-not $SkipNpmCi) {
  Invoke-Checked -FilePath $npmPath -Arguments @("ci") -WorkingDirectory $MiraUiRepo
}

$oldEngineBinary = [System.Environment]::GetEnvironmentVariable("MIRA_ENGINE_LOCAL_BINARY", "Process")
$oldWinSwBinary = [System.Environment]::GetEnvironmentVariable("MIRA_WINSW_LOCAL_BINARY", "Process")
try {
  $env:MIRA_ENGINE_LOCAL_BINARY = $engineExe
  $env:MIRA_WINSW_LOCAL_BINARY = $winSwExe
  Invoke-Checked -FilePath $npmPath -Arguments @("run", "dist:bundle:win", "--", "--arm64") -WorkingDirectory $MiraUiRepo
} finally {
  if ($null -eq $oldEngineBinary) {
    Remove-Item Env:\MIRA_ENGINE_LOCAL_BINARY -ErrorAction SilentlyContinue
  } else {
    $env:MIRA_ENGINE_LOCAL_BINARY = $oldEngineBinary
  }
  if ($null -eq $oldWinSwBinary) {
    Remove-Item Env:\MIRA_WINSW_LOCAL_BINARY -ErrorAction SilentlyContinue
  } else {
    $env:MIRA_WINSW_LOCAL_BINARY = $oldWinSwBinary
  }
}

$setup = Get-ChildItem -Path (Join-Path $MiraUiRepo "release-bundle") -Filter "MIRA-bundle-*-win-arm64-setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) {
  throw "Build finished, but no win-arm64 setup executable was found in release-bundle."
}

Write-Host ""
Write-Host "Built Windows ARM64 bundle installer:" -ForegroundColor Green
Write-Host $setup.FullName
