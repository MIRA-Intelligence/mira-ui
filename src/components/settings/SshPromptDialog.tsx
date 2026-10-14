import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { answerSshPrompt, onSshPrompt, onSshPromptCancel, type SshPrompt } from '@/services/remoteSsh'

// Remote-SSH login prompts, like VS Code's: ssh asks through SSH_ASKPASS and
// the main process forwards each question here. Answers are sent straight back
// and not kept in any store.
export function SshPromptDialog() {
  const lang = useSettingsStore((s) => s.language)
  const [queue, setQueue] = useState<SshPrompt[]>([])
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const offPrompt = onSshPrompt((prompt) => setQueue((current) => [...current, prompt]))
    const offCancel = onSshPromptCancel((id) => setQueue((current) => current.filter((prompt) => prompt.id !== id)))
    return () => {
      offPrompt()
      offCancel()
    }
  }, [])

  const prompt = queue[0]
  useEffect(() => {
    setValue('')
    setReveal(false)
  }, [prompt?.id])

  if (!prompt) return null

  const respond = (answer: string | null) => {
    setQueue((current) => current.filter((item) => item.id !== prompt.id))
    setValue('')
    void answerSshPrompt(prompt.id, answer)
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    respond(prompt.kind === 'host_key' ? 'yes' : value)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      respond(null)
    }
  }
  const hostKey = prompt.kind === 'host_key'

  // Connecting usually starts from Settings, so the prompt must sit above every
  // other overlay (Settings, Providers, the image lightbox at z-[1000]). It is
  // portalled to <body> so no ancestor stacking context can hide it.
  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssh-prompt-title"
      onKeyDown={onKeyDown}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[460px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-xl"
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 id="ssh-prompt-title" className="text-sm font-semibold text-[var(--color-text-primary)] break-all">
            {t('sshPromptTitle', lang, { host: prompt.host })}
          </h2>
          {hostKey && (
            <p className="mt-1 text-xs leading-relaxed text-amber-300">{t('sshPromptHostKeyHint', lang)}</p>
          )}
          {!hostKey && prompt.retry && (
            <p className="mt-1 text-xs leading-relaxed text-red-300" role="alert">{t('sshPromptRetry', lang)}</p>
          )}
        </div>

        <div className="px-4 py-3 space-y-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)] max-h-48 overflow-y-auto">
            {prompt.text.trim()}
          </pre>
          {!hostKey && (
            <div className="flex items-center gap-2">
              <input
                type={reveal ? 'text' : 'password'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label={t('sshPromptAnswer', lang)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="flex-1 h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setReveal((shown) => !shown)}
                className="h-8 px-2 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {reveal ? t('sshPromptHide', lang) : t('sshPromptShow', lang)}
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={() => respond(null)}
            className="h-7 px-3 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            {t('sshPromptCancel', lang)}
          </button>
          <button
            type="submit"
            autoFocus={hostKey}
            className="h-7 px-3 rounded-md bg-[var(--color-accent)] text-xs font-medium text-white hover:opacity-90"
          >
            {hostKey ? t('sshPromptTrust', lang) : t('sshPromptOk', lang)}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
