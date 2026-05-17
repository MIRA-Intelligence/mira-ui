param(
  [string]$MiraRepo = "",
  [string]$MiraUiRepo = "",
  [string]$PythonExe = "",
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

function Assert-Arm64NativeBuildTools {
  $cargo = Get-Command "cargo.exe" -ErrorAction SilentlyContinue
  $rustc = Get-Command "rustc.exe" -ErrorAction SilentlyContinue
  if (-not $cargo -or -not $rustc) {
    throw "Rust/Cargo was not found on PATH. Install ARM64 Rust with rustup, then reopen PowerShell. See README Windows ARM64 bundle prerequisites."
  }

  $rustInfo = & $rustc.Source -Vv
  if ($LASTEXITCODE -ne 0) {
    throw "Could not run rustc -Vv."
  }
  $hostLine = $rustInfo | Where-Object { $_ -like "host:*" } | Select-Object -First 1
  if (-not $hostLine -or $hostLine -notmatch "aarch64-pc-windows-msvc") {
    throw "Rust host must be aarch64-pc-windows-msvc for pure ARM64 builds, got '$hostLine'. Install the ARM64 rustup toolchain and reopen PowerShell."
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    throw "Visual Studio Build Tools were not found. Install VS 2022 C++ Build Tools with ARM64 tools."
  }

  $vcInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath
  if ($LASTEXITCODE -ne 0 -or -not $vcInstall) {
    throw "VS 2022 C++ ARM64 build tools were not found. Install Microsoft.VisualStudio.Workload.VCTools and Microsoft.VisualStudio.Component.VC.Tools.ARM64."
  }
}

function Get-PythonInfo {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  $probeArgs = @($Arguments) + @("-c", "import platform, sys; print(f'{sys.version_info.major}.{sys.version_info.minor};{platform.machine().lower()}')")
  $output = & $FilePath @probeArgs 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) {
    return $null
  }
  return ($output | Select-Object -First 1).Trim()
}

function Assert-Arm64Python311Info {
  param(
    [string]$Info,
    [string]$Context
  )

  $pythonParts = $Info.Split(";")
  if ($pythonParts.Length -lt 2 -or $pythonParts[0] -ne "3.11" -or $pythonParts[1] -notin @("arm64", "aarch64")) {
    throw "$Context must be ARM64 Python 3.11, got '$Info'. Install ARM64 Python 3.11 or pass -PythonExe C:\Path\To\ARM64\python.exe, then rerun with -RecreateVenv."
  }
}

function New-Arm64PythonVenv {
  param(
    [string]$MiraRepo,
    [string]$PythonExe
  )

  if ($PythonExe) {
    if (-not (Test-Path $PythonExe)) {
      throw "PythonExe does not exist: $PythonExe"
    }
    $info = Get-PythonInfo -FilePath $PythonExe
    if (-not $info) {
      throw "Could not run PythonExe: $PythonExe"
    }
    Assert-Arm64Python311Info -Info $info -Context $PythonExe
    Invoke-Checked -FilePath $PythonExe -Arguments @("-m", "venv", ".venv") -WorkingDirectory $MiraRepo
    return
  }

  $pyPath = Get-Command "py.exe" -ErrorAction SilentlyContinue
  if ($pyPath) {
    $info = Get-PythonInfo -FilePath $pyPath.Source -Arguments @("-3.11-arm64")
    if ($info) {
      Assert-Arm64Python311Info -Info $info -Context "py -3.11-arm64"
      Invoke-Checked -FilePath $pyPath.Source -Arguments @("-3.11-arm64", "-m", "venv", ".venv") -WorkingDirectory $MiraRepo
      return
    }
  }

  $pythonPath = Get-Command "python.exe" -ErrorAction SilentlyContinue
  if ($pythonPath) {
    $info = Get-PythonInfo -FilePath $pythonPath.Source
    if ($info) {
      $pythonParts = $info.Split(";")
      if ($pythonParts.Length -ge 2 -and $pythonParts[0] -eq "3.11" -and $pythonParts[1] -in @("arm64", "aarch64")) {
        Invoke-Checked -FilePath $pythonPath.Source -Arguments @("-m", "venv", ".venv") -WorkingDirectory $MiraRepo
        return
      }
    }
  }

  throw "Could not find ARM64 Python 3.11. Install it, or rerun with -PythonExe C:\Path\To\ARM64\python.exe."
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
  Assert-Arm64NativeBuildTools

  $venvPython = Join-Path $MiraRepo ".venv\Scripts\python.exe"
  $venvDir = Join-Path $MiraRepo ".venv"

  if ($RecreateVenv -and (Test-Path $venvDir)) {
    Remove-Item -Recurse -Force $venvDir
  }

  if (-not (Test-Path $venvPython)) {
    New-Arm64PythonVenv -MiraRepo $MiraRepo -PythonExe $PythonExe
  }

  $pythonInfo = Get-PythonInfo -FilePath $venvPython
  Assert-Arm64Python311Info -Info $pythonInfo -Context "Existing venv"

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
