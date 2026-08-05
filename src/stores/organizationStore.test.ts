import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOrganizationStore } from './organizationStore'
import {
  assignOrganizationFolder,
  createOrganizationFolder,
  deleteOrganizationFolder,
  fetchOrganization,
  importOrganizationChats,
} from '@/services/api'

vi.mock('@/services/api', () => ({
  assignOrganizationFolder: vi.fn(),
  createOrganizationFolder: vi.fn(),
  deleteOrganizationFolder: vi.fn(),
  fetchOrganization: vi.fn(),
  importOrganizationChats: vi.fn(),
  renameOrganizationFolder: vi.fn(),
}))

const snapshot = {
  schema_version: 1,
  folders: [{ id: 'folder-1', name: 'Lung cancer', created_at: '2026-01-01', updated_at: '2026-01-01' }],
  chats: [{ id: 'chat-1', title: 'Question', created_at: '2026-01-01', updated_at: '2026-01-02' }],
  assignments: { chat: { 'chat-1': 'folder-1' }, project: {} },
}

describe('organizationStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useOrganizationStore.getState().reset()
  })

  it('imports cached chats before loading the authoritative snapshot', async () => {
    vi.mocked(importOrganizationChats).mockResolvedValue(snapshot.chats)
    vi.mocked(fetchOrganization).mockResolvedValue(snapshot)

    const result = await useOrganizationStore.getState().load(snapshot.chats)

    expect(importOrganizationChats).toHaveBeenCalledWith(snapshot.chats)
    expect(result).toEqual(snapshot)
    expect(useOrganizationStore.getState().folders[0].name).toBe('Lung cancer')
  })

  it('creates a folder and moves an item optimistically', async () => {
    const folder = { id: 'folder-2', name: 'Glioma', created_at: '2026-01-01', updated_at: '2026-01-01' }
    vi.mocked(createOrganizationFolder).mockResolvedValue(folder)
    vi.mocked(assignOrganizationFolder).mockResolvedValue()

    await useOrganizationStore.getState().createFolder('Glioma')
    await useOrganizationStore.getState().moveItem('project', 'PRJ-1', 'folder-2')

    expect(useOrganizationStore.getState().folders).toContainEqual(folder)
    expect(useOrganizationStore.getState().assignments.project['PRJ-1']).toBe('folder-2')
  })

  it('deleting a folder moves its contents to uncategorized', async () => {
    vi.mocked(deleteOrganizationFolder).mockResolvedValue()
    useOrganizationStore.setState({ folders: snapshot.folders, assignments: snapshot.assignments })

    await useOrganizationStore.getState().deleteFolder('folder-1')

    expect(useOrganizationStore.getState().folders).toEqual([])
    expect(useOrganizationStore.getState().assignments.chat).toEqual({})
  })

  it('rolls back a failed move', async () => {
    vi.mocked(assignOrganizationFolder).mockRejectedValue(new Error('offline'))
    useOrganizationStore.setState({ assignments: snapshot.assignments })

    await expect(useOrganizationStore.getState().moveItem('chat', 'chat-1', null)).rejects.toThrow('offline')
    expect(useOrganizationStore.getState().assignments.chat['chat-1']).toBe('folder-1')
  })
})
