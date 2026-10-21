import { useState } from 'react'
import { t } from '@/i18n'
import type { Language } from '@/stores/settingsStore'

interface DeleteChatsDialogProps {
  count: number
  lang: Language
  onConfirm: (deleteFiles: boolean) => void
  onCancel: () => void
}

/** Like project deletion: the user decides whether the chats' local folders go too. */
export function DeleteChatsDialog({ count, lang, onConfirm, onCancel }: DeleteChatsDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('deleteChatsTitle', lang)}
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl w-[360px] p-5"
      >
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
          {t('deleteChatsTitle', lang)}
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-relaxed">
          {t('deleteChatsMessage', lang, { count })}
        </p>

        <label className="flex items-start gap-2 mb-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 accent-[var(--color-error)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)] leading-relaxed group-hover:text-[var(--color-text-primary)] transition-colors">
            {t('deleteChatsFilesLabel', lang)}
            <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
              {t(deleteFiles ? 'deleteChatsFilesHint' : 'deleteChatsKeepHint', lang)}
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {t('cancel', lang)}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteFiles)}
            className="px-3 py-1.5 text-xs rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors font-medium"
          >
            {t(deleteFiles ? 'deleteChatsWithFiles' : 'deleteChatsRemoveOnly', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
