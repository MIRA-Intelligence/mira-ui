import { describe, expect, it } from 'vitest'

import { pickAllowedMeta, scrubEnvelope, scrubText } from './scrubPayload'

describe('scrubText', () => {
  it('returns falsy input unchanged', () => {
    expect(scrubText('')).toBe('')
  })

  it('redacts an 18-digit resident ID', () => {
    expect(scrubText('我的身份证 11010519491231002X 谢谢')).toContain('[REDACTED_ID]')
  })

  it('redacts a 15-digit legacy ID', () => {
    expect(scrubText('编号 110105491231002 完')).toContain('[REDACTED_ID]')
  })

  it('redacts a mainland mobile number', () => {
    expect(scrubText('打我 13800138000')).toContain('[REDACTED_PHONE]')
  })

  it('redacts an email address', () => {
    expect(scrubText('联系 user.name+tag@example.co')).toContain('[REDACTED_EMAIL]')
  })

  it('redacts a medical record number but keeps the keyword', () => {
    const out = scrubText('病历号: A12345')
    expect(out).toContain('病历号')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('A12345')
  })

  it('leaves ordinary text untouched', () => {
    expect(scrubText('the bug happens on click')).toBe('the bug happens on click')
  })
})

describe('scrubEnvelope', () => {
  it('scrubs both title and body', () => {
    const out = scrubEnvelope({ title: 'call 13800138000', body: 'mail a@b.com' })
    expect(out.title).toContain('[REDACTED_PHONE]')
    expect(out.body).toContain('[REDACTED_EMAIL]')
  })
})

describe('pickAllowedMeta', () => {
  it('keeps only allowlisted keys', () => {
    const out = pickAllowedMeta({
      appVersion: '1.0.0',
      os: 'darwin',
      route: '/chat',
      locale: 'en',
      secretToken: 'nope',
      userId: 42,
    })
    expect(out).toEqual({ appVersion: '1.0.0', os: 'darwin', route: '/chat', locale: 'en' })
  })

  it('returns an empty object when nothing is allowed', () => {
    expect(pickAllowedMeta({ foo: 1, bar: 2 })).toEqual({})
  })
})
