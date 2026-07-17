import { useStore } from '../state/store'
import { useChat } from './ChatProvider'
import { FileTree } from '../components/FileTree'

// Bottom sheet for the @-attach fallback: pick a file from the repo tree to inject
// as context for the next message. Reuses the Phase 1 FileTree verbatim.
export function AttachSheet({ onClose }: { onClose: () => void }) {
  const { client, repo, branch } = useStore()
  const { attachFile } = useChat()

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-white/10 bg-bg"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold">Attach a file for context</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-muted hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {client && repo && branch ? (
            <FileTree
              client={client}
              owner={repo.owner}
              repo={repo.name}
              branch={branch}
              onOpenFile={(path) => {
                void attachFile(path)
                onClose()
              }}
            />
          ) : (
            <p className="px-2 py-4 text-sm text-muted">
              Pick a repo first — tap the repo name in the header.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
