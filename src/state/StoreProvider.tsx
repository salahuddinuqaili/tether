import { useEffect, useMemo, useRef, useState } from 'react'
import { clearToken, getToken, setToken } from '../storage/tokens'
import { clearSelection, getSelection, saveSelection } from '../storage/selection'
import { GitHubClient, GitHubError, type GitHubUser } from '../github/client'
import { decodeBase64ToText } from '../lib/base64'
import {
  StoreContext,
  type AuthState,
  type OpenFile,
  type RepoRef,
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
  const [openLoading, setOpenLoading] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  // A client is derived from the token; every GitHub call goes through it.
  const client = useMemo(() => (token ? new GitHubClient(token) : null), [token])
  const clientRef = useRef(client)
  clientRef.current = client

  // Restore the PAT + last repo/branch from IndexedDB on first mount. With a
  // token we land on Browse (or Settings if none) so the flow starts at "pick a
  // repo"; the remembered selection reopens where the user left off.
  useEffect(() => {
    let cancelled = false
    Promise.all([getToken(), getSelection()]).then(([storedToken, storedSelection]) => {
      if (cancelled) return
      setTokenState(storedToken ?? null)
      if (storedSelection) {
        setRepo({
          owner: storedSelection.owner,
          name: storedSelection.name,
          defaultBranch: storedSelection.defaultBranch,
        })
        setBranchState(storedSelection.branch)
      }
      setView(storedToken ? 'browse' : 'settings')
      setTokenLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  const store = useMemo<Store>(
    () => ({
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
      openLoading,
      openError,
      dirty: openFile ? buffer !== openFile.baseContent : false,
      async openFileFromGitHub(path: string) {
        const c = clientRef.current
        if (!c || !repo || !branch) return
        setOpenError(null)
        setOpenLoading(true)
        try {
          const file = await c.getContents(repo.owner, repo.name, path, branch)
          if (file.encoding !== 'base64' || file.content === undefined) {
            throw new Error('This file is too large to open on tether (over 1MB).')
          }
          const text = decodeBase64ToText(file.content)
          setOpenFile({ path: file.path, name: file.name, sha: file.sha, baseContent: text })
          setBuffer(text)
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
      updateBuffer(text: string) {
        setBuffer(text)
      },
      closeFile() {
        setOpenFile(null)
        setBuffer('')
        setOpenError(null)
      },
      view,
      setView,
    }),
    [
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
      openLoading,
      openError,
      view,
    ],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
