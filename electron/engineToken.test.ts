import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gatewayTokenPath, isMainFrameSender, readGatewayToken } from './engineToken'

describe('engine gateway token', () => {
  let home: string
  beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'mira-token-')) })
  afterEach(async () => { await rm(home, { recursive: true, force: true }) })

  it('reads the token the engine writes under MIRA_HOME/runtime', async () => {
    await mkdir(path.join(home, 'runtime'))
    await writeFile(gatewayTokenPath(home), 'AbC_def-0123456789xyz\n', { mode: 0o600 })
    expect(await readGatewayToken(home)).toBe('AbC_def-0123456789xyz')
  })

  it('returns null for a missing or malformed token file', async () => {
    expect(await readGatewayToken(home)).toBeNull()
    await mkdir(path.join(home, 'runtime'))
    await writeFile(gatewayTokenPath(home), 'short')
    expect(await readGatewayToken(home)).toBeNull()
    await writeFile(gatewayTokenPath(home), 'has spaces in the token value')
    expect(await readGatewayToken(home)).toBeNull()
  })

  it('only answers the main window top-level frame', () => {
    const mainFrame = {}
    const main = { mainFrame } as unknown as Electron.WebContents
    const other = { mainFrame: {} } as unknown as Electron.WebContents
    expect(isMainFrameSender({ sender: main, senderFrame: mainFrame } as never, main)).toBe(true)
    expect(isMainFrameSender({ sender: main, senderFrame: {} } as never, main)).toBe(false)
    expect(isMainFrameSender({ sender: other, senderFrame: other.mainFrame } as never, main)).toBe(false)
    expect(isMainFrameSender({ sender: main, senderFrame: mainFrame } as never, null)).toBe(false)
  })
})
