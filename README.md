# MiraUI

AI Agent UI for medical agent workflows, built with React, TypeScript, Vite, Tailwind CSS, and Electron.

## Features

- Desktop-first interface using Electron (`electron-vite` + secure preload)
- Web-first React app that can also run in browser
- Collapsible multi-panel layout for projects, tasks, and agent logs
- Real-time communication setup ready for WebSocket/REST API backends
- Zustand state management and lightweight component architecture
- Responsive layouts and shared design tokens for easy UI iterations

## Contributing / CLA

All external contributions require acceptance of the Contributor License Agreement.
See `CLA.md` for details. By submitting a PR, you confirm acceptance of this CLA.

## Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm 9+
- Git
- A running backend service at least for websocket + REST endpoints (default: `localhost:18790`)

## 1) Installation

From the repository root:

```bash
npm install
```

## 2) Backend assumptions

This UI is designed to connect to the [Mira](https://github.com/MIRA-Intelligence/Mira) gateway through:

- WebSocket endpoint: `/ws`
- REST API endpoint: `/api`

If you are running locally, defaults are expected on `127.0.0.1:18790` unless you override URLs via env.

## 3) Environment configuration

The app reads variables prefixed with `VITE_` from Vite.

Create/adjust these files:

- `.env.development` (already present)
- `.env.production` (for packaged or deployed usage)

```bash
VITE_WS_URL=ws://localhost:18790/ws
VITE_API_URL=http://localhost:18790/api
```

`VITE_WS_URL` and `VITE_API_URL` are currently required by the client services to connect to the backend gateway.

## 4) Development run modes

### A) Web mode (browser)

1. Start web app only:
   ```bash
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173).

### B) Desktop mode (Electron)

1. Start Vite + Electron shell together:
   ```bash
   npm run dev:electron
   ```

   This launches the Electron window and connects to the running Vite dev server.

## 5) Build & packaging

### Web build
  ```bash
  npm run build:web
  ```

Output: `dist/`

### Electron build
  ```bash
  npm run build:electron
  ```

Output: `dist-electron/`

### Preview web build
  ```bash
  npm run preview
  ```

### Packaging

Create an unpacked Electron app directory:

```bash
npm run pack
```

Create distributable installers/packages:

```bash
npm run dist
```

Target specific desktop platforms:

```bash
# macOS artifacts (dmg + zip)
npm run dist:mac

# Windows artifacts (nsis setup + portable)
npm run dist:win

# Build both (best used in CI)
npm run dist:all
```

### Bundle packaging

`MiraUI-bundle` is the local-first desktop flavor. It ships a bundled `mira-engine`, installs the local engine service from the desktop installer, and exposes the local runtime config inside the UI.

By default the bundle build script downloads the platform-specific `mira-engine` asset directly from the `MIRA-Intelligence/mira` GitHub Releases feed. Windows bundle builds also download a WinSW service wrapper so the engine runs as `MiraEngine` without a foreground console window. You can override the sources with:

```bash
# Use a specific mira release asset
export MIRA_ENGINE_RELEASE_TAG=v0.2.0rc8

# Or inject a locally built binary
export MIRA_ENGINE_LOCAL_BINARY=/absolute/path/to/mira-engine

# Windows only: inject a local WinSW wrapper
export MIRA_WINSW_LOCAL_BINARY=/absolute/path/to/WinSW-x64.exe
```

Then build with:

```bash
# macOS bundle artifacts
npm run dist:bundle:mac

# Windows bundle artifacts
npm run dist:bundle:win
```

Bundle artifacts are written to `release-bundle/` and use the `MIRA-bundle-*` naming convention. Windows bundle builds publish the NSIS setup artifact only; the portable bundle is intentionally not produced because the engine is registered as a Windows Service.

For a local Windows ARM64 test machine, such as Windows on Apple Silicon via Parallels, use the helper script from an ARM64 PowerShell session:

```powershell
.\scripts\build-win-arm64-bundle.ps1
```

The script builds an ARM64 `mira-engine.exe`, downloads the .NET Framework `WinSW-net461.exe` wrapper, and emits a `win-arm64` setup executable. This is for ARM64 functional testing only; run the normal x64 bundle path before publishing for x64 Windows users. Native ARM64 Python dependency builds require VS 2022 C++ Build Tools and ARM64 Rust:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"

curl.exe -L -o "$env:TEMP\rustup-init-aarch64.exe" "https://static.rust-lang.org/rustup/dist/aarch64-pc-windows-msvc/rustup-init.exe"
& "$env:TEMP\rustup-init-aarch64.exe" -y --default-toolchain stable
```

`cryptography` also needs ARM64 OpenSSL development libraries when pip builds it from source:

```powershell
cd C:\Users\$env:USERNAME\Code
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat -disableMetrics
.\vcpkg.exe install openssl:arm64-windows
```

After installing these prerequisites, close and reopen ARM64 PowerShell before running the bundle script:

```powershell
.\scripts\build-win-arm64-bundle.ps1 -OpenSslDir C:\Users\$env:USERNAME\Code\vcpkg\installed\arm64-windows
```

If GitHub release downloads are unstable in the VM, download the ARM64 assets in a browser and pass them to the script:

```powershell
.\scripts\build-win-arm64-bundle.ps1 `
  -OpenSslDir C:\Users\$env:USERNAME\Code\vcpkg\installed\arm64-windows `
  -UvArchive C:\Users\$env:USERNAME\Downloads\uv-aarch64-pc-windows-msvc.zip `
  -WinSwLocalBinary C:\Users\$env:USERNAME\Downloads\WinSW-net461.exe
```

If the Python launcher defaults to an x64 Python 3.11 on Windows ARM64, install ARM64 Python 3.11 and pass it explicitly:

```powershell
.\scripts\build-win-arm64-bundle.ps1 -PythonExe C:\Path\To\ARM64\python.exe -RecreateVenv
```

## 6) Script reference

- `npm run dev` → start Vite development server on port 5173 (web mode)
- `npm run dev:electron` → start Electron with Vite integration
- `npm run build:web` → compile web client for production (`dist/`)
- `npm run build:electron` → compile Electron main/preload/renderer bundles (`dist-electron/`)
- `npm run build:desktop` → run both web + electron production builds
- `npm run preview` → preview compiled web assets
- `npm run pack` → generate unpacked desktop app into `release/`
- `npm run dist` → generate installers for the current OS into `release/`
- `npm run dist:mac` → generate macOS `dmg` and `zip` packages
- `npm run dist:win` → generate Windows setup/portable executables (CI wraps each into zip before release upload)
- `npm run dist:all` → attempt both macOS and Windows packaging in one run
- `npm run dist:mac` uses local Electron distribution and unsigned packaging (`mac.identity=null`) for local release preparation
- `npm run dist:bundle:mac` → generate the `MIRA-bundle` macOS installers into `release-bundle/`
- `npm run dist:bundle:win` → generate the `MIRA-bundle` Windows installers into `release-bundle/`

## 7) Project structure

- `electron/main.ts`  
  Electron main process bootstrap and browser window setup
- `electron/preload.ts`  
  Safe bridge exposed to renderer (`window.electronAPI`)
- `src/main.tsx`  
  React app bootstrap
- `src/App.tsx`  
  App shell and layout composition
- `src/components/**`  
  Reusable UI components (top bar, queue, panel, agent log, etc.)
- `src/stores/**`  
  Zustand stores for app/project/agent state
- `src/hooks/**`  
  Reusable client logic and side-effect hooks
- `src/services/**`  
  API, websocket, and data adapters
- `src/lib/utils.ts`  
  Shared utility helpers
- `src/styles/globals.css`  
  Global styling and tokens

## 8) Recommended launch sequence (for first-time setup)

1. Ensure backend is available at `ws://localhost:18790/ws` and `http://localhost:18790/api`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start web mode first:
   ```bash
   npm run dev
   ```
4. In a separate terminal, run desktop mode if desired:
   ```bash
   npm run dev:electron
   ```
5. Build artifacts when ready for handoff or release:
   ```bash
   npm run build:web && npm run build:electron
   ```

## 9) Troubleshooting

### App cannot connect to backend
- Confirm backend server is running on the configured host/port.
- Verify `.env.development` values or the currently exported environment variables match backend URLs.
- Check that CORS (for web mode) and websocket upgrade policies allow local connections.

### Electron window opens but is blank
- Re-run `npm run build:electron` to regenerate renderer output.
- Confirm Vite dev server is running when using `npm run dev:electron`.
- Run from repo root to avoid path resolution issues.

### Desktop release artifacts
- Primary release workflow: `.github/workflows/desktop-release.yml`
- A single `v*` tag now publishes both `MIRA-standalone-*` and `MIRA-bundle-*` assets into the same GitHub Release
- Manual bundle rebuild workflow: `.github/workflows/desktop-release-bundle.yml`
- Generated installers are uploaded as workflow artifacts and also written to local `release/` or `release-bundle/` when run locally
