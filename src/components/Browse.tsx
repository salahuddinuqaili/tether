import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { GitHubError, type GitHubBranch, type GitHubRepo } from '../github/client'
import { FileTree } from './FileTree'

// Repo + branch selection (P1-T3). Pick a repo by typing `owner/repo` or from
// the list the token can see; the default branch is preselected. The tree
// (P1-T4) renders below once a repo + branch are chosen.
export function Browse() {
  const { client, repo, branch, openFile, dirty, selectRepo, setBranch, clearRepo, openFileFromGitHub } =
    useStore()

  // Opening a different file replaces the buffer, so confirm before discarding
  // unsaved edits (P1-T6). Re-tapping the already-open file is a no-op prompt.
  function handleOpenFile(path: string) {
    if (dirty && openFile && path !== openFile.path) {
      if (!window.confirm(`Discard unsaved changes to ${openFile.name}?`)) return
    }
    void openFileFromGitHub(path)
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5">
      {!repo ? (
        <RepoPicker
          onPick={selectRepo}
          list={() => client!.listRepos()}
          disabled={!client}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {repo.owner}/{repo.name}
              </div>
              <div className="text-xs text-muted">default: {repo.defaultBranch}</div>
            </div>
            <button
              type="button"
              onClick={clearRepo}
              className="ml-auto rounded-md border border-white/10 px-2.5 py-1 text-xs text-muted hover:text-white"
            >
              Change repo
            </button>
          </div>

          <BranchSelector
            key={`${repo.owner}/${repo.name}`}
            current={branch ?? repo.defaultBranch}
            onSelect={setBranch}
            list={() => client!.listBranches(repo.owner, repo.name)}
          />

          <FileTree
            client={client!}
            owner={repo.owner}
            repo={repo.name}
            branch={branch ?? repo.defaultBranch}
            onOpenFile={handleOpenFile}
            activePath={openFile?.path}
          />
        </div>
      )}
    </div>
  )
}

function RepoPicker({
  onPick,
  list,
  disabled,
}: {
  onPick: (owner: string, name: string) => Promise<void>
  list: () => Promise<GitHubRepo[]>
  disabled: boolean
}) {
  const [typed, setTyped] = useState('')
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    list()
      .then((r) => !cancelled && setRepos(r))
      .catch((e) => !cancelled && setError(messageOf(e)))
    return () => {
      cancelled = true
    }
  }, [disabled])

  async function pick(owner: string, name: string) {
    setError(null)
    setBusy(true)
    try {
      await onPick(owner, name)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const [owner, name] = typed.trim().split('/')
    if (!owner || !name) {
      setError('Enter as owner/repo')
      return
    }
    await pick(owner, name)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Open a repo</h2>
        <p className="mt-1 text-sm text-muted">Type owner/repo, or pick one below.</p>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="owner/repo"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !typed.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          Open
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-col divide-y divide-white/5 rounded-lg border border-white/10">
        {repos === null && !error && <div className="p-3 text-sm text-muted">Loading repos…</div>}
        {repos?.length === 0 && <div className="p-3 text-sm text-muted">No repos visible to this token.</div>}
        {repos?.map((r) => (
          <button
            key={r.full_name}
            type="button"
            disabled={busy}
            onClick={() => pick(r.owner.login, r.name)}
            className="flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/5 disabled:opacity-50"
          >
            <span className="truncate">{r.full_name}</span>
            {r.private && <span className="ml-auto text-[10px] uppercase text-muted">private</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function BranchSelector({
  current,
  onSelect,
  list,
}: {
  current: string
  onSelect: (branch: string) => void
  list: () => Promise<GitHubBranch[]>
}) {
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    list()
      .then((b) => !cancelled && setBranches(b))
      .catch((e) => !cancelled && setError(messageOf(e)))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Branch</span>
      <select
        value={current}
        onChange={(e) => onSelect(e.target.value)}
        disabled={!branches}
        className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface px-2 py-1.5 outline-none focus:border-accent"
      >
        {/* Ensure the current/default branch is selectable even before the list loads. */}
        {!branches?.some((b) => b.name === current) && <option value={current}>{current}</option>}
        {branches?.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </label>
  )
}

function messageOf(e: unknown): string {
  if (e instanceof GitHubError) return e.message
  return e instanceof Error ? e.message : 'Something went wrong'
}
