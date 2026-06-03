import { useState } from 'react'

interface DeleteConfirmDialogProps {
  projectId: string
  projectLabel: string
  onConfirm: (deleteFiles: boolean) => void
  onCancel: () => void
}

export function DeleteConfirmDialog({ projectId, projectLabel, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-xl w-[360px] p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
          Delete Project
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-relaxed">
          Are you sure you want to delete <span className="font-mono font-semibold">{projectLabel}</span> ({projectId})?
        </p>

        <label className="flex items-start gap-2 mb-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 accent-[var(--color-error)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)] leading-relaxed group-hover:text-[var(--color-text-primary)] transition-colors">
            Also delete local workspace files
            <span className="block text-[10px] text-[var(--color-text-muted)] mt-0.5">
              This will permanently remove the project directory and all its data from disk.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteFiles)}
            className="px-3 py-1.5 text-xs rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors font-medium"
          >
            {deleteFiles ? 'Delete All' : 'Remove from UI'}
          </button>
        </div>
      </div>
    </div>
  )
}
