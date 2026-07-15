import { useState } from 'react'
import { useStore } from '../state/store'
import { Editor } from '../editor/Editor'

// Connects the CodeMirror editor to the open file in the store (P1-T5), shows the
// dirty indicator (P1-T6), and hosts the commit bar + 409 conflict resolution
// (P1-T7). Empty state until a file is opened from Browse.
export function EditorPane() {
  const {
    openFile,
    buffer,
    dirty,
    openLoading,
    openError,
    committing,
    commitError,
    conflict,
    updateBuffer,
    commitFile,
    overwriteRemote,
    discardAndReload,
    setView,
  } = useStore()

  const [message, setMessage] = useState('')
  const [committed, setCommitted] = useState(false)

  if (openLoading) return <CenteredNote>Opening file…</CenteredNote>

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

  async function onCommit(commitFn: (m: string) => Promise<boolean>) {
    const msg = message.trim() || `Update ${openFile!.name} via tether`
    const ok = await commitFn(msg)
    if (ok) {
      setMessage('')
      setCommitted(true)
      setTimeout(() => setCommitted(false), 2500)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dirty ? 'bg-amber-400' : 'bg-white/20'}`}
          aria-hidden
        />
        <span className="truncate text-white/70">{openFile.path}</span>
        {dirty && <span className="shrink-0 text-amber-400">unsaved</span>}
        {committed && !dirty && <span className="ml-auto shrink-0 text-accent">✓ committed</span>}
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          docId={`${openFile.path}@${openFile.sha}`}
          initialDoc={buffer}
          filename={openFile.name}
          onChange={updateBuffer}
        />
      </div>

      {/* Commit bar (P1-T7). */}
      <div
        className="border-t border-white/10 bg-surface px-3 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
      >
        {conflict ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-amber-400">
              {commitError ?? 'This file changed on GitHub since you opened it.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={committing}
                onClick={() => onCommit(overwriteRemote)}
                className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                {committing ? 'Committing…' : 'Overwrite with my changes'}
              </button>
              <button
                type="button"
                disabled={committing}
                onClick={discardAndReload}
                className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
              >
                Discard mine, load latest
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {commitError && <p className="text-xs text-red-400">{commitError}</p>}
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Update ${openFile.name} via tether`}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={!dirty || committing}
                onClick={() => onCommit(commitFile)}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                {committing ? 'Committing…' : 'Commit'}
              </button>
            </div>
          </div>
        )}
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
