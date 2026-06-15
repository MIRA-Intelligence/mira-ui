import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sha256Directory, sha256File } from './engine-payload-hash.mjs'

describe('engine payload hashing', () => {
  let dir

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'engine-payload-hash-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function seedOneDirPayload(root) {
    await writeFile(path.join(root, 'mira-engine.exe'), 'launcher-bootloader')
    await mkdir(path.join(root, '_internal'), { recursive: true })
    await writeFile(path.join(root, '_internal', 'engine.pyc'), 'engine-code-v1')
    await writeFile(path.join(root, '_internal', 'libdep.dll'), 'native-bytes')
  }

  it('produces a stable digest covering every file in the tree', async () => {
    await seedOneDirPayload(dir)
    const first = await sha256Directory(dir)
    const second = await sha256Directory(dir)
    expect(first.sha256).toBe(second.sha256)
    expect(first.size).toBe('launcher-bootloader'.length + 'engine-code-v1'.length + 'native-bytes'.length)
  })

  it('flips the digest when a non-launcher payload file changes', async () => {
    await seedOneDirPayload(dir)
    const before = await sha256Directory(dir)

    // Simulate an engine update that only touches a bundled native library /
    // data file inside _internal, leaving the launcher byte-identical.
    await writeFile(path.join(dir, '_internal', 'libdep.dll'), 'native-bytes-v2')
    const after = await sha256Directory(dir)

    expect(after.sha256).not.toBe(before.sha256)
  })

  it('ignores excluded sidecar files', async () => {
    await seedOneDirPayload(dir)
    const baseline = await sha256Directory(dir)

    const manifestPath = path.join(dir, 'mira-engine.manifest.json')
    const feedbackPath = path.join(dir, 'mira-engine.feedback.json')
    const winswPath = path.join(dir, 'MiraEngineService.exe')
    await writeFile(manifestPath, '{"sha256":"self-reference"}')
    await writeFile(feedbackPath, '{"feishu":{}}')
    await writeFile(winswPath, 'winsw-wrapper')

    const withSidecars = await sha256Directory(dir, {
      exclude: [manifestPath, feedbackPath, winswPath],
    })
    expect(withSidecars.sha256).toBe(baseline.sha256)
  })

  it('detects path renames even when bytes are unchanged', async () => {
    await seedOneDirPayload(dir)
    const before = await sha256Directory(dir)

    await rm(path.join(dir, '_internal', 'engine.pyc'))
    await writeFile(path.join(dir, '_internal', 'engine-renamed.pyc'), 'engine-code-v1')
    const after = await sha256Directory(dir)

    expect(after.sha256).not.toBe(before.sha256)
  })

  it('hashes a single file payload (macOS/Linux one-file shape)', async () => {
    const filePath = path.join(dir, 'mira-engine')
    await writeFile(filePath, 'self-contained-binary')
    const digest = await sha256File(filePath)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
