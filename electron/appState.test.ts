import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockElectron = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => mockElectron.userDataDir,
  },
}))

import {
  getLastDeploymentMode,
  getSkippedVersions,
  getSshMiraPath,
  readAppState,
  setLastDeploymentMode,
  setSkippedVersions,
  setSshMiraPath,
} from './appState'

describe('appState', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mira-ui-app-state-'))
    mockElectron.userDataDir = dir
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns an empty state when nothing is persisted', async () => {
    const state = await readAppState()
    expect(state).toEqual({ skippedVersions: [], lastDeploymentMode: null, sshMiraPaths: {} })
  })

  it('round-trips the last deployment mode', async () => {
    await setLastDeploymentMode('remoteManual')
    expect(await getLastDeploymentMode()).toBe('remoteManual')

    await setLastDeploymentMode('localBundle')
    expect(await getLastDeploymentMode()).toBe('localBundle')
  })

  it('round-trips skipped versions without dropping the deployment mode', async () => {
    await setLastDeploymentMode('remoteManual')
    await setSkippedVersions(['0.4.0', '0.5.0'])

    expect(await getSkippedVersions()).toEqual(['0.4.0', '0.5.0'])
    expect(await getLastDeploymentMode()).toBe('remoteManual')
  })

  it('migrates the legacy update-state.json skip list on first read', async () => {
    await writeFile(
      path.join(dir, 'update-state.json'),
      JSON.stringify({ skippedVersions: ['1.2.3'] }),
      'utf8',
    )

    const state = await readAppState()
    expect(state.skippedVersions).toEqual(['1.2.3'])

    // The migrated state should now live in the generalized file.
    const migrated = JSON.parse(await readFile(path.join(dir, 'app-state.json'), 'utf8'))
    expect(migrated.skippedVersions).toEqual(['1.2.3'])
  })

  it('prefers the new file over the legacy one when both exist', async () => {
    await writeFile(
      path.join(dir, 'update-state.json'),
      JSON.stringify({ skippedVersions: ['legacy'] }),
      'utf8',
    )
    await writeFile(
      path.join(dir, 'app-state.json'),
      JSON.stringify({ skippedVersions: ['current'], lastDeploymentMode: 'localBundle' }),
      'utf8',
    )

    const state = await readAppState()
    expect(state.skippedVersions).toEqual(['current'])
    expect(state.lastDeploymentMode).toBe('localBundle')
  })

  it('ignores malformed persisted content', async () => {
    await writeFile(path.join(dir, 'app-state.json'), 'not json', 'utf8')
    expect(await readAppState()).toEqual({ skippedVersions: [], lastDeploymentMode: null, sshMiraPaths: {} })
  })

  it('remembers the last working remote mira path per SSH host', async () => {
    expect(await getSshMiraPath('lab')).toBeNull()
    await setLastDeploymentMode('remoteSsh')
    await setSshMiraPath('lab', '/home/ana/miniconda3/envs/mira/bin/mira')
    await setSshMiraPath('ana@gpu:2222', "/home/ana/my envs/it's/bin/mira")
    expect(await getSshMiraPath('lab')).toBe('/home/ana/miniconda3/envs/mira/bin/mira')
    expect(await getSshMiraPath('ana@gpu:2222')).toBe("/home/ana/my envs/it's/bin/mira")
    expect(await getLastDeploymentMode()).toBe('remoteSsh')

    // Relative paths, control characters and backslashes are never stored.
    await setSshMiraPath('lab', 'mira')
    await setSshMiraPath('lab', '/bin/mi\nra')
    await setSshMiraPath('lab', '/bin/mira\n')
    expect(await getSshMiraPath('lab')).toBe('/home/ana/miniconda3/envs/mira/bin/mira')
  })

  it('drops malformed remembered paths when reading', async () => {
    await writeFile(path.join(dir, 'app-state.json'), JSON.stringify({ sshMiraPaths: { lab: '/ok/bin/mira', bad: 'relative', worse: 7 } }), 'utf8')
    expect((await readAppState()).sshMiraPaths).toEqual({ lab: '/ok/bin/mira' })
  })
})
