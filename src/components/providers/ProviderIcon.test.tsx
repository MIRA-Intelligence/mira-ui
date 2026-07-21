import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProviderIcon } from './ProviderIcon'
import { providerDescription, providerDocsUrl } from './catalog'

describe('ProviderIcon', () => {
  it('renders the brand image for a mapped provider', () => {
    const { container } = render(<ProviderIcon provider="openai" displayName="OpenAI" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBeTruthy()
  })

  it('renders an initials badge for an unmapped provider', () => {
    render(<ProviderIcon provider="totally-unknown" displayName="Zeta" />)
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('falls back to the initials badge when the image fails to load', () => {
    const { container } = render(<ProviderIcon provider="openai" displayName="OpenAI" />)
    const img = container.querySelector('img') as HTMLImageElement
    fireEvent.error(img)
    expect(screen.getByText('O')).toBeInTheDocument()
  })
})

describe('provider catalog helpers', () => {
  it('returns bilingual descriptions', () => {
    expect(providerDescription('deepseek', 'en')).toMatch(/DeepSeek/i)
    expect(providerDescription('deepseek', 'zh')).toMatch(/DeepSeek/i)
    expect(providerDescription('totally-unknown', 'en')).toBeNull()
  })

  it('returns docs URLs when present', () => {
    expect(providerDocsUrl('openai')).toContain('http')
    expect(providerDocsUrl('totally-unknown')).toBeNull()
  })
})
