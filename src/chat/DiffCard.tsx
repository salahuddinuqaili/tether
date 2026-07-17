import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { GitHubError } from '../github/client'
import { decodeBase64ToText } from '../lib/base64'
import { DiffView } from './DiffView'
import type { ProposedEdit } from './edits'

// Inline diff card for one proposed edit. Resolves the baseline (the open file's
// remote baseline, else a fetch, else empty for a new file), renders the unified
// diff, and offers Apply (→ editor + commit bar) / Dismiss. The commit itself reuses
// the Phase 1 flow untouched (P2-T6).
export function DiffCard({ edit }: { edit: ProposedEdit }) {
  const { client, repo, branch, openFile, openProposedEdit } = useStore()
  const [baseline, setBaseline] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [applied, setApplied] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    // Prefer the open file's known remote baseline; otherwise fetch it; a 404 means
    // the agent is proposing a brand-new file (diff against empty).
    if (openFile && openFile.path === edit.path) {
      setBaseline(openFile.baseContent)
      setIsNew(false)
      return
    }
    if (!client || !repo || !branch) {
      setBaseline('')
      setIsNew(true)
      return
    }
    void (async () => {
      try {
        const file = await client.getContents(repo.owner, repo.name, edit.path, branch)
        const text =
          file.encoding === 'base64' && file.content !== undefined
            ? decodeBase64ToText(file.content)
            : ''
        if (!cancelled) {
          setBaseline(text)
          setIsNew(false)
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof GitHubError && e.status === 404) {
          setBaseline('')
          setIsNew(true)
        } else {
          setError(e instanceof Error ? e.message : 'Could not load the current file.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [edit.path, client, repo, branch, openFile])

  if (dismissed) return null

  async function onApply() {
    setApplying(true)
    try {
      await openProposedEdit(edit.path, edit.newContent)
      setApplied(true)
    } finally {
      setApplying(false)
    }
  }

  const filename = edit.path.split('/').pop() ?? edit.path

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-bg">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <span className="shrink-0 text-accent">✎ proposed edit</span>
        <span className="min-w-0 flex-1 truncate font-mono text-white/80">{edit.path}</span>
        {isNew && (
          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
            new file
          </span>
        )}
      </div>

      {error ? (
        <p className="px-3 py-2 text-xs text-red-400">{error}</p>
      ) : baseline === null ? (
        <p className="px-3 py-2 text-xs text-muted">Loading diff…</p>
      ) : (
        <DiffView baseline={baseline} proposed={edit.newContent} filename={filename} />
      )}

      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={onApply}
          disabled={applying || applied || baseline === null || !!error}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
        >
          {applied ? '✓ Applied — review & commit in the editor' : applying ? 'Applying…' : 'Apply'}
        </button>
        {!applied && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-muted hover:text-white"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
