import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  const raw = await readFile(filePath)
  hash.update(raw)
  return hash.digest('hex')
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

function toPosixRelative(dir, file) {
  return path.relative(dir, file).split(path.sep).join('/')
}

/**
 * Fingerprint an entire directory tree (e.g. a PyInstaller one-dir payload)
 * so that any change to a bundled file flips the digest. The hash folds in
 * each file's POSIX-relative path *and* its bytes, walked in a deterministic
 * sorted order, so the result is stable regardless of filesystem iteration
 * order. Paths listed in `exclude` are skipped — used for sidecar files we
 * manage separately (manifest, feedback config, WinSW wrapper) that must not
 * pollute the engine identity.
 */
export async function sha256Directory(dir, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map((entry) => path.resolve(entry)))
  const files = (await listFilesRecursive(dir)).filter((file) => !excluded.has(path.resolve(file)))
  files.sort((a, b) => {
    const ra = toPosixRelative(dir, a)
    const rb = toPosixRelative(dir, b)
    if (ra < rb) return -1
    if (ra > rb) return 1
    return 0
  })

  const hash = createHash('sha256')
  let size = 0
  for (const file of files) {
    const raw = await readFile(file)
    hash.update(toPosixRelative(dir, file))
    hash.update('\u0000')
    hash.update(raw)
    hash.update('\u0000')
    size += raw.length
  }
  return { sha256: hash.digest('hex'), size }
}
