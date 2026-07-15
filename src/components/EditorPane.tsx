import { useStore } from '../state/store'
import { Editor } from '../editor/Editor'

// Connects the CodeMirror editor to the open file in the store (P1-T5). Shows an
// empty state until a file is opened from Browse; the commit action + dirty
// indicator land here in P1-T6/T7.
export function EditorPane() {
  const { openFile, buffer, dirty, openLoading, openError, updateBuffer, setView } = useStore()

  if (openLoading) {
    return <CenteredNote>Opening file…</CenteredNote>
  }

  if (!openFile) {
    return (
      <CenteredNote>
        {openError ? (
          <span className="text-red-400">{openError}</span>
        ) : (
          <>
            No file open.{' '}
            <button
              type="button"
              onClick={() => setView('browse')}
              className="text-accent underline underline-offset-2"
            >
              Browse a repo
            </button>{' '}
            to open one.
          </>
        )}
      </CenteredNote>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs">
        {/* Dirty indicator: a filled amber dot + "unsaved" when the buffer
            diverges from the GitHub baseline (P1-T6). */}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dirty ? 'bg-amber-400' : 'bg-white/20'}`}
          aria-hidden
        />
        <span className="truncate text-white/70">{openFile.path}</span>
        {dirty && <span className="shrink-0 text-amber-400">unsaved</span>}
        {openError && <span className="ml-auto text-red-400">{openError}</span>}
      </div>
      <div className="min-h-0 flex-1">
        {/* docId keyed to path+sha so opening a different file (or a fresh commit
            baseline) rebuilds the editor with the new content. */}
        <Editor
          docId={`${openFile.path}@${openFile.sha}`}
          initialDoc={buffer}
          filename={openFile.name}
          onChange={updateBuffer}
        />
      </div>
    </div>
  )
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
      <p>{children}</p>
    </div>
  )
}
