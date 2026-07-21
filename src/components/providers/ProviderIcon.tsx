import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PROVIDER_CATALOG } from './catalog'

interface ProviderIconProps {
  provider: string
  displayName?: string
  size?: number
  className?: string
}

// Renders the LobeHub brand SVG for a provider, falling back to an initials
// badge when no icon is mapped or the asset fails to load.
export function ProviderIcon({ provider, displayName, size = 24, className }: ProviderIconProps) {
  const entry = PROVIDER_CATALOG[provider]
  const [errored, setErrored] = useState(false)

  // Reset the error state when the provider changes so a previously-failed
  // icon does not stick when the component is reused for another provider.
  useEffect(() => {
    setErrored(false)
  }, [provider])

  if (entry?.icon && !errored) {
    return (
      <img
        src={entry.icon}
        alt=""
        width={size}
        height={size}
        className={cn('rounded object-contain', className)}
        style={{ width: size, height: size }}
        onError={() => setErrored(true)}
      />
    )
  }

  const label = (displayName || provider || '?').trim()
  const initial = label.charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] font-semibold',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.45)) }}
    >
      {initial}
    </span>
  )
}
