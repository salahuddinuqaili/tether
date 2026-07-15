import { useEffect, useMemo, useState } from 'react'
import { clearToken, getToken, setToken } from '../storage/tokens'
import { GitHubClient, GitHubError, type GitHubUser } from '../github/client'
import { StoreContext, type AuthState, type Store, type View } from './store'

// Holds all app state and wires it to on-device persistence. Grows per Phase 1
// task (repo/branch/tree/open-file come later); P1-T1/T2 handle PAT + auth.
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [tokenLoaded, setTokenLoaded] = useState(false)
  const [view, setView] = useState<View>('editor')

  const [auth, setAuth] = useState<AuthState>('idle')
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  // A client is derived from the token; every GitHub call goes through it.
  const client = useMemo(() => (token ? new GitHubClient(token) : null), [token])

  // Restore the PAT from IndexedDB on first mount. If one exists we land on the
  // editor; otherwise we open Settings so the user can paste a token.
  useEffect(() => {
    let cancelled = false
    getToken().then((stored) => {
      if (cancelled) return
      setTokenState(stored ?? null)
      setView(stored ? 'editor' : 'settings')
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
      view,
      setView,
    }),
    [token, tokenLoaded, client, auth, user, authError, view],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
