# MedPilotUI

AI Agent UI for radiology workflows, built with React, TypeScript, Vite, Tailwind CSS, and Electron.

## Features

- Desktop-first interface using Electron (`electron-vite` + secure preload)
- Web-first React app that can also run in browser
- Collapsible multi-panel layout for projects, tasks, and agent logs
- Real-time communication setup ready for WebSocket/REST API backends
- Zustand state management and lightweight component architecture
- Responsive layouts and shared design tokens for easy UI iterations

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

This UI is designed to connect to the radiologybot gateway through:

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

## 6) Script reference

- `npm run dev` → start Vite development server on port 5173 (web mode)
- `npm run dev:electron` → start Electron with Vite integration
- `npm run build:web` → compile web client for production (`dist/`)
- `npm run build:electron` → compile Electron main/preload/renderer bundles (`dist-electron/`)
- `npm run preview` → preview compiled web assets
- `npm run pack` → package app contents without installer
- `npm run dist` → generate installers for the current OS

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
