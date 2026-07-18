import { useState } from 'react'
import { useStore } from '../state/store'
import { Endpoints } from './Endpoints'

// PAT entry + on-device storage UI (P1-T1). The token is written straight to
// IndexedDB via the store; this component never logs it and never renders it
// back — once saved we show only a masked "connected" state.
export function Settings() {
  const { token, auth, user, authError, saveToken, removeToken, setView } = useStore()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await saveToken(draft)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save token')
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    setBusy(true)
    try {
      await removeToken()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col gap-6 overflow-y-auto p-5">
      <div>
        <h2 className="text-base font-semibold">GitHub access</h2>
        <p className="mt-1 text-sm text-muted">
          Paste a <span className="text-white/80">fine-grained personal access token</span> scoped
          to your repos with <span className="text-white/80">Contents: read &amp; write</span>. It
          is stored only on this device and sent only to GitHub.
        </p>
      </div>

      {token ? (
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-surface p-4">
          {auth === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-2 rounded-full bg-white/40" aria-hidden />
              <span>Verifying token…</span>
            </div>
          )}
          {auth === 'valid' && user && (
            <div className="flex items-center gap-2 text-sm">
              <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full" />
              <span>
                Connected as <span className="font-semibold text-accent">{user.login}</span>
              </span>
            </div>
          )}
          {auth === 'invalid' && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
              <span>{authError ?? 'Token could not be verified.'}</span>
            </div>
          )}
          <p className="text-xs text-muted">
            Hidden for safety — tether never displays a stored token. Remove it to paste a new one.
          </p>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="self-start rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            Remove token
          </button>
        </div>
      ) : (
        <form onSubmit={onSave} className="flex flex-col gap-3">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="rounded-md border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            Save token
          </button>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline underline-offset-2"
          >
            Create a fine-grained token on GitHub →
          </a>
        </form>
      )}

      <Endpoints />

      <button
        type="button"
        onClick={() => setView('editor')}
        className="mt-auto self-start text-sm text-muted hover:text-white"
      >
        ← Back to editor
      </button>
    </div>
  )
}
