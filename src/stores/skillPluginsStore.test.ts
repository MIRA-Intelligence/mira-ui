import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  fetchSkillPlugins: vi.fn(),
  installSkillPluginFromDirectory: vi.fn(),
  installSkillPluginFromZip: vi.fn(),
  setSkillPluginState: vi.fn(),
  uninstallSkillPlugin: vi.fn(),
}))

import * as api from '@/services/api'
import { useSkillPluginsStore } from './skillPluginsStore'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>
const initial = useSkillPluginsStore.getState()

const plugin = { id: 'p1', name: 'Plugin 1' } as never

describe('skillPluginsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSkillPluginsStore.setState(initial, true)
    useSkillPluginsStore.setState({
      plugins: [],
      scope: 'global',
      loading: false,
      error: null,
      installPath: '',
    })
  })

  it('setScope / setInstallPath / clearError update state', () => {
    const s = useSkillPluginsStore.getState()
    s.setScope('project')
    s.setInstallPath('/tmp/plugin')
    useSkillPluginsStore.setState({ error: 'boom' })
    s.clearError()
    const next = useSkillPluginsStore.getState()
    expect(next.scope).toBe('project')
    expect(next.installPath).toBe('/tmp/plugin')
    expect(next.error).toBeNull()
  })

  it('load populates plugins on success', async () => {
    mocked.fetchSkillPlugins.mockResolvedValueOnce([plugin])
    await useSkillPluginsStore.getState().load('s1')
    expect(useSkillPluginsStore.getState().plugins).toEqual([plugin])
    expect(useSkillPluginsStore.getState().loading).toBe(false)
  })

  it('load records the error message on failure', async () => {
    mocked.fetchSkillPlugins.mockRejectedValueOnce(new Error('load failed'))
    await useSkillPluginsStore.getState().load('s1')
    expect(useSkillPluginsStore.getState().error).toBe('load failed')
    expect(useSkillPluginsStore.getState().loading).toBe(false)
  })

  it('installFromDirectory requires a path', async () => {
    await useSkillPluginsStore.getState().installFromDirectory('s1')
    expect(useSkillPluginsStore.getState().error).toMatch(/required/i)
    expect(mocked.installSkillPluginFromDirectory).not.toHaveBeenCalled()
  })

  it('installFromDirectory installs and clears the path on success', async () => {
    mocked.installSkillPluginFromDirectory.mockResolvedValueOnce([plugin])
    useSkillPluginsStore.setState({ installPath: '/tmp/x' })
    await useSkillPluginsStore.getState().installFromDirectory('s1')
    expect(mocked.installSkillPluginFromDirectory).toHaveBeenCalledWith('s1', '/tmp/x')
    expect(useSkillPluginsStore.getState().installPath).toBe('')
    expect(useSkillPluginsStore.getState().plugins).toEqual([plugin])
  })

  it('installFromZip stores the returned plugins', async () => {
    mocked.installSkillPluginFromZip.mockResolvedValueOnce([plugin])
    const file = new File(['x'], 'p.zip')
    await useSkillPluginsStore.getState().installFromZip('s1', file)
    expect(mocked.installSkillPluginFromZip).toHaveBeenCalledWith('s1', file)
    expect(useSkillPluginsStore.getState().plugins).toEqual([plugin])
  })

  it('toggle forwards scope and target details', async () => {
    mocked.setSkillPluginState.mockResolvedValueOnce([plugin])
    useSkillPluginsStore.setState({ scope: 'project' })
    await useSkillPluginsStore.getState().toggle('s1', 'skill', 'p1', true, 'tgt')
    expect(mocked.setSkillPluginState).toHaveBeenCalledWith('s1', {
      scope: 'project',
      target_type: 'skill',
      plugin_id: 'p1',
      enabled: true,
      target_id: 'tgt',
    })
  })

  it('uninstall records errors', async () => {
    mocked.uninstallSkillPlugin.mockRejectedValueOnce('nope')
    await useSkillPluginsStore.getState().uninstall('s1', 'p1')
    expect(useSkillPluginsStore.getState().error).toBe('nope')
  })
})
