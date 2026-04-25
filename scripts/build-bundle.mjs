import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
const enginePath = path.resolve(
  process.cwd(),
  'bundled-engine',
  platformDir,
  process.platform === 'win32' ? 'mira-engine.exe' : 'mira-engine',
)

if (!existsSync(enginePath)) {
  console.error(`Bundled engine binary not found: ${enginePath}`)
  console.error('Populate bundled-engine/<platform>/ before running bundle packaging.')
  process.exit(1)
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
