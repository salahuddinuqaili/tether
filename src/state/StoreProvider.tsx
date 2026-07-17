import { useEffect, useMemo, useRef, useState } from 'react'
import { clearToken, getToken, setToken } from '../storage/tokens'
import { clearSelection, getSelection, saveSelection } from '../storage/selection'
import { clearSession, loadSession, saveSession } from '../storage/buffers'
import { GitHubClient, GitHubError, type GitHubUser } from '../github/client'
import { decodeBase64ToText, encodeTextToBase64 } from '../lib/base64'
import {
  StoreContext,
  type AuthState,
  type OpenFile,
  type RepoRef,
  type ShaConflict,
  type Store,
  type View,
} from './store'

// Holds all app state and wires it to on-device persistence. Grows per Phase 1
// task (repo/branch/tree/open-file come later); P1-T1/T2 handle PAT + auth.
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [tokenLoaded, setTokenLoaded] = useState(false)
  const [view, setView] = useState<View>('editor')

  const [auth, setAuth] = useState<AuthState>('idle')
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  const [repo, setRepo] = useState<RepoRef | null>(null)
  const [branch, setBranchState] = useState<string | null>(null)

  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [buffer, setBuffer] = useState('')
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [openLoading, setOpenLoading] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ShaConflict | null>(null)

  // A client is derived from the token; every GitHub call goes through it.
  const client = useMemo(() => (token ? new GitHubClient(token) : null), [token])
  const clientRef = useRef(client)
  clientRef.current = client

  // Restore the PAT + last repo/branch from IndexedDB and any unsaved editing
  // session from OPFS on first mount (P1-T8). A restored session reopens the exact
  // file + buffer (including unsaved edits) with no network call; otherwise we
  // land on Browse so the flow starts at "pick a repo".
  useEffect(() => {
    let cancelled = false
    Promise.all([getToken(), getSelection(), loadSession()]).then(
      ([storedToken, storedSelection, session]) => {
        if (cancelled) return
        setTokenState(storedToken ?? null)

        if (session) {
          // The session carries its own repo/branch context so the editor and a
          // later commit target the right place even if it differs from selection.
          setRepo(session.repo)
          setBranchState(session.branch)
          setOpenFile(session.file)
          setBuffer(session.buffer)
        } else if (storedSelection) {
          setRepo({
            owner: storedSelection.owner,
            name: storedSelection.name,
            defaultBranch: storedSelection.defaultBranch,
          })
          setBranchState(storedSelection.branch)
        }

        // Chat-first landing (D5): no token → settings; a restored unsaved editing
        // session reopens the editor so work isn't lost; a known repo → chat (home);
        // otherwise browse to pick a repo first.
        const landing: View = !storedToken
          ? 'settings'
          : session
            ? 'editor'
            : storedSelection
              ? 'chat'
              : 'browse'
        setView(landing)
        setTokenLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Persist the editing session to OPFS whenever the open file or buffer changes,
  // debounced so typing doesn't hammer the filesystem. Clearing the file clears
  // the cache. Skipped until the initial restore has run, so we never overwrite a
  // stored session with the empty startup state.
  useEffect(() => {
    if (!tokenLoaded) return
    if (!openFile || !repo || !branch) {
      void clearSession()
      return
    }
    const id = setTimeout(() => {
      void saveSession({ repo, branch, file: openFile, buffer })
    }, 400)
    return () => clearTimeout(id)
  }, [tokenLoaded, openFile, buffer, repo, branch])

  // Validate the token whenever it changes by resolving GET /user (P1-T2).
  useEffect(() => {
    if (!client) {
      setAuth('idle')
      setUser(null)
      setAuthError(null)
      return
    }
    const ctrl = new AbortController()
    setAuth('checking')
    setAuthError(null)
    client
      .getUser(ctrl.signal)
      .then((u) => {
        setUser(u)
        setAuth('valid')
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setUser(null)
        setAuth('invalid')
        setAuthError(
          err instanceof GitHubError ? err.message : 'Could not reach GitHub. Check your network.',
        )
      })
    return () => ctrl.abort()
  }, [client])

  const store = useMemo<Store>(() => {
    // Shared commit path for a first attempt and a post-conflict retry. `sha` is
    // the blob being replaced. On HTTP 409 the held sha is stale, so we re-fetch
    // the current remote file and expose it as a conflict for the user to resolve
    // (P1-T7). Returns true only when the commit actually lands.
    async function runCommit(message: string, sha: string): Promise<boolean> {
      const c = clientRef.current
      if (!c || !repo || !branch || !openFile) return false
      const text = buffer
      setCommitError(null)
      setCommitting(true)
      try {
        const result = await c.putFile(repo.owner, repo.name, openFile.path, {
          message,
          content: encodeTextToBase64(text),
          branch,
          // Omit sha to CREATE a new file (agent-proposed new files have no sha);
          // include it to UPDATE an existing one (a stale value still yields 409).
          ...(sha ? { sha } : {}),
        })
        // Success: adopt the new blob sha and reset the baseline to what we just
        // committed, so the buffer is clean again.
        setOpenFile({ ...openFile, sha: result.content.sha, baseContent: text })
        setConflict(null)
        return true
      } catch (e) {
        if (e instanceof GitHubError && e.status === 409) {
          try {
            const latest = await c.getContents(repo.owner, repo.name, openFile.path, branch)
            const remoteContent =
              latest.encoding === 'base64' && latest.content !== undefined
                ? decodeBase64ToText(latest.content)
                : ''
            setConflict({ remoteSha: latest.sha, remoteContent })
            setCommitError(
              'This file changed on GitHub since you opened it. Choose how to resolve below.',
            )
          } catch {
            setCommitError('The file changed on GitHub and could not be re-fetched. Try again.')
          }
        } else {
          setCommitError(
            e instanceof GitHubError || e instanceof Error ? e.message : 'Commit failed.',
          )
        }
        return false
      } finally {
        setCommitting(false)
      }
    }

    return {
      token,
      tokenLoaded,
      async saveToken(pat: string) {
        await setToken(pat)
        setTokenState(pat.trim())
      },
      async removeToken() {
        await clearToken()
        setTokenState(null)
      },
      client,
      auth,
      user,
      authError,
      repo,
      branch,
      async selectRepo(owner: string, name: string) {
        const c = clientRef.current
        if (!c) throw new GitHubError(401, 'No token — add a PAT in Settings first.')
        const resolved = await c.getRepo(owner, name)
        const ref: RepoRef = {
          owner: resolved.owner.login,
          name: resolved.name,
          defaultBranch: resolved.default_branch,
        }
        setRepo(ref)
        setBranchState(resolved.default_branch)
        await saveSelection({ ...ref, branch: resolved.default_branch })
      },
      setBranch(next: string) {
        setBranchState(next)
        if (repo) void saveSelection({ ...repo, branch: next })
      },
      clearRepo() {
        setRepo(null)
        setBranchState(null)
        void clearSelection()
      },

      openFile,
      buffer,
      editorEpoch,
      openLoading,
      openError,
      dirty: openFile ? buffer !== openFile.baseContent : false,
      async openFileFromGitHub(path: string) {
        const c = clientRef.current
        if (!c || !repo || !branch) return
        setOpenError(null)
        setCommitError(null)
        setConflict(null)
        setOpenLoading(true)
        try {
          const file = await c.getContents(repo.owner, repo.name, path, branch)
          if (file.encoding !== 'base64' || file.content === undefined) {
            throw new Error('This file is too large to open on tether (over 1MB).')
          }
          const text = decodeBase64ToText(file.content)
          setOpenFile({ path: file.path, name: file.name, sha: file.sha, baseContent: text })
          setBuffer(text)
          setEditorEpoch((n) => n + 1)
          setView('editor')
        } catch (e) {
          setOpenError(
            e instanceof GitHubError || e instanceof Error
              ? e.message
              : 'Could not open the file.',
          )
        } finally {
          setOpenLoading(false)
        }
      },
      async openProposedEdit(path: string, newContent: string) {
        const c = clientRef.current
        if (!c || !repo || !branch) return
        setOpenError(null)
        setCommitError(null)
        setConflict(null)
        setOpenLoading(true)
        try {
          // Hold the current remote sha + baseline so the commit replaces the right
          // blob and the diff/dirty baseline is correct. A 404 means a brand-new file.
          let sha = ''
          let baseContent = ''
          try {
            const file = await c.getContents(repo.owner, repo.name, path, branch)
            sha = file.sha
            baseContent =
              file.encoding === 'base64' && file.content !== undefined
                ? decodeBase64ToText(file.content)
                : ''
          } catch (e) {
            if (!(e instanceof GitHubError && e.status === 404)) throw e
          }
          const name = path.split('/').pop() ?? path
          setOpenFile({ path, name, sha, baseContent })
          setBuffer(newContent) // dirty vs baseContent → commit bar appears
          setEditorEpoch((n) => n + 1)
          setView('editor')
        } catch (e) {
          setOpenError(
            e instanceof GitHubError || e instanceof Error
              ? e.message
              : 'Could not open the proposed edit.',
          )
        } finally {
          setOpenLoading(false)
        }
      },
      updateBuffer(text: string) {
        setBuffer(text)
      },
      closeFile() {
        setOpenFile(null)
        setBuffer('')
        setOpenError(null)
        setCommitError(null)
        setConflict(null)
      },

      committing,
      commitError,
      conflict,
      commitFile(message: string) {
        if (!openFile) return Promise.resolve(false)
        return runCommit(message, openFile.sha)
      },
      overwriteRemote(message: string) {
        // Retry against the freshly re-fetched remote sha: local edits win.
        if (!conflict) return Promise.resolve(false)
        return runCommit(message, conflict.remoteSha)
      },
      discardAndReload() {
        // Drop local edits and adopt the latest remote content (now clean).
        if (!openFile || !conflict) return
        setOpenFile({ ...openFile, sha: conflict.remoteSha, baseContent: conflict.remoteContent })
        setBuffer(conflict.remoteContent)
        setEditorEpoch((n) => n + 1)
        setConflict(null)
        setCommitError(null)
      },

      view,
      setView,
    }
  }, [
    token,
    tokenLoaded,
    client,
    auth,
    user,
    authError,
    repo,
    branch,
    openFile,
    buffer,
    editorEpoch,
    openLoading,
    openError,
    committing,
    commitError,
    conflict,
    view,
  ])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
