import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const engineDir = path.resolve(process.cwd(), 'bundled-engine', platformDir)
const enginePath = path.resolve(
  process.cwd(),
  'bundled-engine',
  platformDir,
  process.platform === 'win32' ? 'mira-engine.exe' : 'mira-engine',
)
const winswPath = path.join(engineDir, 'MiraEngineService.exe')

function bundledEngineAssetName() {
  if (process.platform === 'darwin') {
    return `mira-engine-macos-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`
  }
  if (process.platform === 'win32') {
    return 'mira-engine-windows-x86_64.exe'
  }
  return 'mira-engine-linux-x86_64'
}

function hasGhCli() {
  const result = spawnSync('gh', ['--version'], { stdio: 'ignore' })
  return result.status === 0
}

function normalizeVersionToTag(version) {
  return `v${version.replace(/-rc\.(\d+)$/, 'rc$1')}`
}

async function packageVersionToReleaseTag() {
  const raw = await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8')
  const pkg = JSON.parse(raw)
  return normalizeVersionToTag(pkg.version)
}

function latestReleaseTag(repo) {
  const result = spawnSync(
    'gh',
    ['release', 'view', '--repo', repo, '--json', 'tagName', '--jq', '.tagName'],
    {
      encoding: 'utf8',
      env: process.env,
    },
  )
  if (result.status === 0) {
    const tag = result.stdout.trim()
    if (tag) return tag
  }
  return null
}

async function downloadReleaseAsset() {
  const repo = process.env.MIRA_ENGINE_REPO || 'MIRA-Intelligence/mira'
  const configuredTag = process.env.MIRA_ENGINE_RELEASE_TAG?.trim()
  const releaseTag = configuredTag || latestReleaseTag(repo) || await packageVersionToReleaseTag()
  const asset = bundledEngineAssetName()
  const targetDir = path.dirname(enginePath)

  await mkdir(targetDir, { recursive: true })

  const result = spawnSync(
    'gh',
    ['release', 'download', releaseTag, '--repo', repo, '--pattern', asset, '--dir', targetDir, '--clobber'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to download ${asset} from ${repo}@${releaseTag}`)
  }

  const downloadedPath = path.join(targetDir, asset)
  if (downloadedPath !== enginePath) {
    await rename(downloadedPath, enginePath)
  }
  await chmod(enginePath, 0o755)
}

async function copyLocalEngineBinary(localBinary) {
  const targetDir = path.dirname(enginePath)
  await mkdir(targetDir, { recursive: true })
  await copyFile(localBinary, enginePath)
  await chmod(enginePath, 0o755)
}

async function copyLocalWinSwBinary(localBinary) {
  await mkdir(engineDir, { recursive: true })
  await copyFile(localBinary, winswPath)
  await chmod(winswPath, 0o755)
}

async function downloadWinSwAsset() {
  const repo = process.env.MIRA_WINSW_REPO || 'winsw/winsw'
  const configuredTag = process.env.MIRA_WINSW_RELEASE_TAG?.trim()
  const releaseTag = configuredTag || latestReleaseTag(repo)
  if (!releaseTag) {
    throw new Error(`Unable to resolve latest WinSW release tag from ${repo}`)
  }

  await mkdir(engineDir, { recursive: true })
  const result = spawnSync(
    'gh',
    ['release', 'download', releaseTag, '--repo', repo, '--pattern', 'WinSW-x64.exe', '--dir', engineDir, '--clobber'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to download WinSW-x64.exe from ${repo}@${releaseTag}`)
  }

  const downloadedPath = path.join(engineDir, 'WinSW-x64.exe')
  if (downloadedPath !== winswPath) {
    await rename(downloadedPath, winswPath)
  }
  await chmod(winswPath, 0o755)
}

async function ensureWindowsServiceWrapper() {
  if (process.platform !== 'win32') return

  const localBinary = process.env.MIRA_WINSW_LOCAL_BINARY?.trim()
  if (localBinary) {
    await copyLocalWinSwBinary(localBinary)
    return
  }

  if (hasGhCli()) {
    try {
      await downloadWinSwAsset()
      return
    } catch (error) {
      if (!existsSync(winswPath)) {
        throw error
      }
      console.warn(String(error))
      console.warn(`Falling back to existing WinSW wrapper at ${winswPath}`)
      return
    }
  }

  if (!existsSync(winswPath)) {
    throw new Error(
      `Windows service wrapper not found: ${winswPath}\n` +
      'Install gh and set MIRA_WINSW_RELEASE_TAG, or provide MIRA_WINSW_LOCAL_BINARY.',
    )
  }
}

async function ensureBundledEngine() {
  const localBinary = process.env.MIRA_ENGINE_LOCAL_BINARY?.trim()
  if (localBinary) {
    await copyLocalEngineBinary(localBinary)
    return
  }

  if (hasGhCli()) {
    try {
      await downloadReleaseAsset()
      return
    } catch (error) {
      if (!existsSync(enginePath)) {
        throw error
      }
      console.warn(String(error))
      console.warn(`Falling back to existing bundled engine at ${enginePath}`)
      return
    }
  }

  if (!existsSync(enginePath)) {
    throw new Error(
      `Bundled engine binary not found: ${enginePath}\n` +
      'Install gh and set MIRA_ENGINE_RELEASE_TAG, or provide MIRA_ENGINE_LOCAL_BINARY.',
    )
  }
}

const builderArgs = [
  './node_modules/electron-builder/cli.js',
  '--publish',
  'never',
  '-c',
  'electron-builder.bundle.config.cjs',
  ...args,
]

if (process.platform === 'darwin' && args.includes('--mac')) {
  builderArgs.push('-c.electronDist=node_modules/electron/dist')
}

await ensureBundledEngine()
await ensureWindowsServiceWrapper()

const child = spawn(process.execPath, builderArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    MIRA_UI_BUNDLE: '1',
    ...(process.platform === 'darwin' ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : {}),
  },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
