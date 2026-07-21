import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRemoteProject,
  deleteProject,
  deleteProjectFiles,
  fetchFeedbackConfig,
  fetchPlan,
  fetchPlanContract,
  fetchProjects,
  fetchSessionHistory,
  fetchSkillPlugins,
  fetchStatus,
  getProjectArtifactUrl,
  installSkillPluginFromDirectory,
  installSkillPluginFromZip,
  setSkillPluginState,
  submitFeedbackReport,
  uninstallSkillPlugin,
  updateProjectDisplayName,
  updateProjectRuntimePreferences,
  uploadProjectFiles,
  validateDataPath,
} from './api'
import type { FeedbackPayload } from './api'

const fetchMock = vi.fn()

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}
function fail(body: unknown, status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}
function badJson(ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => {
      throw new Error('not json')
    },
    text: async () => 'plain text',
  } as unknown as Response
}

function lastUrl(): string {
  return String(fetchMock.mock.calls.at(-1)?.[0] ?? '')
}

describe('api service', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchPlan', () => {
    it('returns the plan on success', async () => {
      fetchMock.mockResolvedValueOnce(ok({ steps: [] }))
      expect(await fetchPlan('PRJ-1')).toEqual({ steps: [] })
      expect(lastUrl()).toContain('/plan?session_id=PRJ-1')
    })
    it('returns null on non-ok, error payload, or throw', async () => {
      fetchMock.mockResolvedValueOnce(fail('nope'))
      expect(await fetchPlan()).toBeNull()
      fetchMock.mockResolvedValueOnce(ok({ error: 'x' }))
      expect(await fetchPlan()).toBeNull()
      fetchMock.mockRejectedValueOnce(new Error('net'))
      expect(await fetchPlan()).toBeNull()
    })
  })

  describe('fetchPlanContract', () => {
    it('returns null without a session id', async () => {
      expect(await fetchPlanContract()).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('returns the contract on success and null on error', async () => {
      fetchMock.mockResolvedValueOnce(ok({ version: 2 }))
      expect(await fetchPlanContract('PRJ-1')).toEqual({ version: 2 })
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchPlanContract('PRJ-1')).toBeNull()
    })
  })

  describe('fetchStatus', () => {
    it('returns json or null', async () => {
      fetchMock.mockResolvedValueOnce(ok({ a: 1 }))
      expect(await fetchStatus()).toEqual({ a: 1 })
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchStatus()).toBeNull()
    })
  })

  describe('feedback config + report', () => {
    it('normalizes feedback config', async () => {
      fetchMock.mockResolvedValueOnce(ok({ configured: true, invite_url: 'https://i' }))
      expect(await fetchFeedbackConfig()).toEqual({ configured: true, inviteUrl: 'https://i' })
    })
    it('returns defaults when not ok', async () => {
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchFeedbackConfig()).toEqual({ configured: false, inviteUrl: null })
    })
    it('submitFeedbackReport returns inviteUrl on success', async () => {
      fetchMock.mockResolvedValueOnce(ok({ configured: true, inviteUrl: 'https://j' }))
      const payload = { id: '1', title: 't' } as unknown as FeedbackPayload
      expect(await submitFeedbackReport(payload)).toEqual({ inviteUrl: 'https://j' })
    })
    it('submitFeedbackReport throws server error message', async () => {
      fetchMock.mockResolvedValueOnce(fail({ error: 'rejected' }, 400))
      const payload = { id: '1' } as unknown as FeedbackPayload
      await expect(submitFeedbackReport(payload)).rejects.toThrow('rejected')
    })
  })

  describe('createRemoteProject', () => {
    it('maps camelCase payload to snake_case body', async () => {
      fetchMock.mockResolvedValueOnce(ok({ id: 'PRJ-1', has_plan: false }))
      await createRemoteProject({ projectId: 'PRJ-1', displayName: 'X', runMode: 'auto' })
      const init = fetchMock.mock.calls[0][1]
      expect(JSON.parse(init.body)).toEqual({ project_id: 'PRJ-1', display_name: 'X', run_mode: 'auto' })
    })
    it('throws response text on failure', async () => {
      fetchMock.mockResolvedValueOnce(fail('cannot create'))
      await expect(createRemoteProject({})).rejects.toThrow('cannot create')
    })
  })

  describe('fetchProjects', () => {
    it('returns the projects array, [] when missing, null on error', async () => {
      fetchMock.mockResolvedValueOnce(ok({ projects: [{ id: 'a', has_plan: true }] }))
      expect(await fetchProjects()).toHaveLength(1)
      fetchMock.mockResolvedValueOnce(ok({}))
      expect(await fetchProjects()).toEqual([])
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchProjects()).toBeNull()
    })
  })

  describe('updateProjectDisplayName', () => {
    it('returns trimmed display name or falls back to sessionId', async () => {
      fetchMock.mockResolvedValueOnce(ok({ display_name: '  New  ' }))
      expect(await updateProjectDisplayName('PRJ-1', 'New')).toBe('New')
      fetchMock.mockResolvedValueOnce(ok({}))
      expect(await updateProjectDisplayName('PRJ-1', 'New')).toBe('PRJ-1')
    })
    it('throws on failure', async () => {
      fetchMock.mockResolvedValueOnce(fail('bad'))
      await expect(updateProjectDisplayName('PRJ-1', 'New')).rejects.toThrow('bad')
    })
  })

  describe('updateProjectRuntimePreferences', () => {
    it('short-circuits when no fields provided', async () => {
      expect(await updateProjectRuntimePreferences('PRJ-1', {})).toEqual({})
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('maps server response back to typed fields', async () => {
      fetchMock.mockResolvedValueOnce(ok({ run_mode: 'auto', agent_profile: 'research', contract_version: 2 }))
      expect(await updateProjectRuntimePreferences('PRJ-1', { runMode: 'auto' })).toEqual({
        runMode: 'auto',
        agentProfile: 'research',
        contractVersion: 2,
      })
    })
  })

  describe('fetchSessionHistory', () => {
    it('returns entries or [] on error', async () => {
      fetchMock.mockResolvedValueOnce(ok({ entries: [{ id: '1' }] }))
      expect(await fetchSessionHistory('PRJ-1')).toHaveLength(1)
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchSessionHistory('PRJ-1')).toEqual([])
    })
  })

  describe('deleteProject', () => {
    it('deletes files and returns result', async () => {
      fetchMock.mockResolvedValueOnce(ok({ deleted: true }))
      const res = await deleteProject('PRJ-1', { deleteFiles: true })
      expect(res.deleted).toBe(true)
      expect(lastUrl()).toContain('/projects?session_id=PRJ-1')
    })
    it('removes (no file deletion) via the remove endpoint', async () => {
      fetchMock.mockResolvedValueOnce(ok({ removed: true }))
      const res = await deleteProject('PRJ-1', { deleteFiles: false })
      expect(res.removed).toBe(true)
      expect(lastUrl()).toContain('/remove')
    })
    it('throws when files were not deleted', async () => {
      fetchMock.mockResolvedValueOnce(ok({ deleted: false, reason: 'busy' }))
      await expect(deleteProject('PRJ-1', { deleteFiles: true })).rejects.toThrow('busy')
    })
    it('throws server error on non-ok', async () => {
      fetchMock.mockResolvedValueOnce(fail({ error: 'denied' }, 403))
      await expect(deleteProject('PRJ-1')).rejects.toThrow('denied')
    })
    it('deleteProjectFiles returns the deleted flag', async () => {
      fetchMock.mockResolvedValueOnce(ok({ deleted: true }))
      expect(await deleteProjectFiles('PRJ-1')).toBe(true)
    })
  })

  describe('uploadProjectFiles', () => {
    it('returns empty result for no files', async () => {
      expect(await uploadProjectFiles('PRJ-1', [])).toEqual({ uploaded: [], extracted: [] })
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('posts form data and maps the response', async () => {
      fetchMock.mockResolvedValueOnce(ok({ uploaded: [{ name: 'a', path: 'p', size: 1 }], extracted: [] }))
      const file = new File(['x'], 'a.txt')
      const res = await uploadProjectFiles('PRJ-1', [file], 'references')
      expect(res.uploaded).toHaveLength(1)
      expect(lastUrl()).toContain('target=references')
    })
    it('throws a useful message on failure', async () => {
      fetchMock.mockResolvedValueOnce(fail({ error: 'too big' }, 413))
      await expect(uploadProjectFiles('PRJ-1', [new File(['x'], 'a')])).rejects.toThrow('too big')
    })
  })

  describe('validateDataPath', () => {
    it('returns the validation result on success', async () => {
      fetchMock.mockResolvedValueOnce(ok({ ok: true, kind: 'file', resolved_path: '/abs' }))
      expect(await validateDataPath('/x')).toEqual({ ok: true, kind: 'file', error: undefined, resolved_path: '/abs' })
    })
    it('returns ok:false with a message on failure', async () => {
      fetchMock.mockResolvedValueOnce(badJson(false, 400))
      const res = await validateDataPath('/x')
      expect(res.ok).toBe(false)
      expect(res.error).toBe('plain text')
    })
  })

  it('getProjectArtifactUrl builds an encoded url', () => {
    const url = getProjectArtifactUrl('PRJ 1', 'a/b.png')
    expect(url).toContain('/projects/PRJ%201/artifacts?path=a%2Fb.png')
  })

  describe('skill plugins', () => {
    it('fetchSkillPlugins returns plugins or [] on error', async () => {
      fetchMock.mockResolvedValueOnce(ok({ plugins: [{ id: 'p' }] }))
      expect(await fetchSkillPlugins('s')).toHaveLength(1)
      fetchMock.mockResolvedValueOnce(fail('x'))
      expect(await fetchSkillPlugins('s')).toEqual([])
    })
    it('installSkillPluginFromDirectory returns plugins and throws on error', async () => {
      fetchMock.mockResolvedValueOnce(ok({ plugins: [] }))
      expect(await installSkillPluginFromDirectory('s', '/p')).toEqual([])
      fetchMock.mockResolvedValueOnce(fail('boom'))
      await expect(installSkillPluginFromDirectory('s', '/p')).rejects.toThrow('boom')
    })
    it('installSkillPluginFromZip posts form data', async () => {
      fetchMock.mockResolvedValueOnce(ok({ plugins: [{ id: 'p' }] }))
      expect(await installSkillPluginFromZip('s', new File(['x'], 'p.zip'))).toHaveLength(1)
    })
    it('setSkillPluginState forwards payload', async () => {
      fetchMock.mockResolvedValueOnce(ok({ plugins: [] }))
      await setSkillPluginState('s', {
        scope: 'global',
        target_type: 'skill',
        plugin_id: 'p',
        enabled: true,
      })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ plugin_id: 'p', enabled: true })
    })
    it('uninstallSkillPlugin throws on failure', async () => {
      fetchMock.mockResolvedValueOnce(fail('cannot'))
      await expect(uninstallSkillPlugin('s', 'p')).rejects.toThrow('cannot')
    })
  })
})
