import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetClientIdCache, getClientId, getDisplayHandle } from './clientId'
import { installLocalStorage } from '@/test/localStorage'

const STORAGE_KEY = 'medpilot-client-id'

describe('clientId', () => {
  beforeEach(() => {
    installLocalStorage()
    __resetClientIdCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __resetClientIdCache()
  })

  it('generates and persists a fresh anon id', () => {
    const id = getClientId()
    expect(id).toMatch(/^anon_/)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id)
  })

  it('returns a cached value on repeated calls', () => {
    const first = getClientId()
    const second = getClientId()
    expect(second).toBe(first)
  })

  it('reuses an existing stored id', () => {
    localStorage.setItem(STORAGE_KEY, 'anon_stored1234')
    expect(getClientId()).toBe('anon_stored1234')
  })

  it('derives a short stable display handle from the id', () => {
    localStorage.setItem(STORAGE_KEY, 'anon_abcd1234')
    const handle = getDisplayHandle()
    expect(handle).toBe('anon_1234')
    // stable across calls
    expect(getDisplayHandle()).toBe(handle)
  })

  it('falls back to xxxx when the id has no alphanumeric tail', () => {
    localStorage.setItem(STORAGE_KEY, '----')
    expect(getDisplayHandle()).toBe('anon_xxxx')
  })
})
