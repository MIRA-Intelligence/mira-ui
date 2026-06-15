import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const engineDir = path.resolve(process.cwd(), 'bundled-engine', platformDir)
const enginePayloadDir = process.platform === 'win32'
  ? path.join(engineDir, 'mira-engine')
  : engineDir
const enginePath = path.join(
  enginePayloadDir,
  process.platform === 'win32' ? 'mira-engine.exe' : 'mira-engine',
)
const engineManifestPath = path.resolve(enginePayloadDir, 'mira-engine.manifest.json')
const feedbackConfigPath = path.resolve(enginePayloadDir, 'mira-engine.feedback.json')
const winswPath = path.join(enginePayloadDir, 'MiraEngineService.exe')

async function localElectronDistPreservesFrameworkSymlinks() {
  if (process.platform !== 'darwin') return false
  const frameworkLink = path.resolve(
    process.cwd(),
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework',
  )
  try {
    return (await lstat(frameworkLink)).isSymbolicLink()
  } catch {
    return false
  }
}

function bundleVersionOverrideArgs() {
  const version = process.env.MIRA_UI_BUNDLE_VERSION?.trim()
  const artifactVersion = process.env.MIRA_UI_BUNDLE_ARTIFACT_VERSION?.trim()
  const overrides = []

  if (version) {
    overrides.push(`-c.extraMetadata.version=${version}`)
  }
  if (artifactVersion) {
    overrides.push(`-c.nsis.artifactName=MIRA-bundle-${artifactVersion}-\${os}-\${arch}-setup.\${ext}`)
  }

  return overrides
}

function bundledEngineAssetName() {
  if (process.platform === 'darwin') {
    return `mira-engine-macos-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`
  }
  if (process.platform === 'win32') {
    return 'mira-engine-windows-x86_64.zip'
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
  const targetDir = process.platform === 'win32' ? engineDir : path.dirname(enginePath)

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
  if (process.platform === 'win32') {
    await rm(enginePayloadDir, { recursive: true, force: true })
    const extract = spawnSync('tar', ['-xf', downloadedPath, '-C', targetDir], {
      stdio: 'inherit',
      env: process.env,
    })
    if (extract.status !== 0) {
      throw new Error(`Failed to extract ${downloadedPath}`)
    }
    if (!existsSync(enginePath)) {
      throw new Error(`Downloaded Windows engine asset did not contain ${enginePath}`)
    }
    await rm(downloadedPath, { force: true })
  } else if (downloadedPath !== enginePath) {
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

async function copyLocalEngineDirectory(localDir) {
  if (process.platform !== 'win32') {
    throw new Error('MIRA_ENGINE_LOCAL_DIR is only supported for Windows one-dir engine bundles.')
  }
  const launcher = path.join(localDir, 'mira-engine.exe')
  if (!existsSync(launcher)) {
    throw new Error(`MIRA_ENGINE_LOCAL_DIR must contain mira-engine.exe: ${launcher}`)
  }
  await rm(enginePayloadDir, { recursive: true, force: true })
  await mkdir(path.dirname(enginePayloadDir), { recursive: true })
  await cp(localDir, enginePayloadDir, { recursive: true })
  await chmod(enginePath, 0o755)
}

async function copyLocalWinSwBinary(localBinary) {
  await mkdir(engineDir, { recursive: true })
  await copyFile(localBinary, winswPath)
  await chmod(winswPath, 0o755)
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const raw = await readFile(filePath)
  hash.update(raw)
  return hash.digest('hex')
}

function currentGitSha(cwd) {
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

function currentPackageVersion() {
  const version = process.env.MIRA_UI_BUNDLE_VERSION?.trim()
  if (version) return version
  try {
    const raw = spawnSync(process.execPath, [
      '-e',
      "process.stdout.write(require('./package.json').version || '')",
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return raw.status === 0 ? raw.stdout.trim() || null : null
  } catch {
    return null
  }
}

async function writeBundledEngineManifest() {
  const stats = await stat(enginePath)
  const feedbackConfigSha256 = existsSync(feedbackConfigPath) ? await sha256File(feedbackConfigPath) : null
  const manifest = {
    schema: 1,
    kind: 'mira-bundled-engine',
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    executable: path.relative(engineDir, enginePath).split(path.sep).join('/'),
    sha256: await sha256File(enginePath),
    size: stats.size,
    uiBundleVersion: currentPackageVersion(),
    engineReleaseTag: process.env.MIRA_ENGINE_RELEASE_TAG?.trim() || null,
    source: process.env.MIRA_ENGINE_LOCAL_DIR?.trim() || process.env.MIRA_ENGINE_LOCAL_BINARY?.trim() ? 'local' : 'release',
    miraUiGitSha: currentGitSha(process.cwd()),
    feedbackConfigSha256,
  }
  await writeFile(engineManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function writeBundledFeedbackConfig() {
  const webhookUrl = process.env.MIRA_FEISHU_WEBHOOK_URL?.trim()
  if (!webhookUrl) {
    await rm(feedbackConfigPath, { force: true })
    return
  }
  const payload = {
    schema: 1,
    kind: 'mira-feedback-relay',
    generatedAt: new Date().toISOString(),
    feishu: {
      webhookUrl,
      secret: process.env.MIRA_FEISHU_WEBHOOK_SECRET?.trim() || '',
      inviteUrl: process.env.MIRA_FEISHU_GROUP_INVITE_URL?.trim() || '',
      mentionOpenId: process.env.MIRA_FEISHU_MENTION_OPEN_ID?.trim() || '',
      mentionName: process.env.MIRA_FEISHU_MENTION_NAME?.trim() || 'MIRAI',
    },
  }
  await mkdir(path.dirname(feedbackConfigPath), { recursive: true })
  await writeFile(feedbackConfigPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
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
  const localDir = process.env.MIRA_ENGINE_LOCAL_DIR?.trim()
  if (localDir) {
    await copyLocalEngineDirectory(localDir)
    return
  }

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
      'Install gh and set MIRA_ENGINE_RELEASE_TAG, or provide MIRA_ENGINE_LOCAL_DIR (Windows one-dir) or MIRA_ENGINE_LOCAL_BINARY.',
    )
  }
}

const builderArgs = [
  './node_modules/electron-builder/cli.js',
  '--publish',
  'never',
  '-c',
  'electron-builder.bundle.config.cjs',
  ...bundleVersionOverrideArgs(),
  ...args,
]

if (process.platform === 'darwin' && args.includes('--mac') && await localElectronDistPreservesFrameworkSymlinks()) {
  builderArgs.push('-c.electronDist=node_modules/electron/dist')
} else if (process.platform === 'darwin' && args.includes('--mac')) {
  console.warn('Local Electron dist does not preserve macOS framework symlinks; using electron-builder default Electron runtime.')
}

await ensureBundledEngine()
await writeBundledFeedbackConfig()
await writeBundledEngineManifest()
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
