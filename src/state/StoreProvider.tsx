import { useEffect, useMemo, useState } from 'react'
import { clearToken, getToken, setToken } from '../storage/tokens'
import { StoreContext, type Store, type View } from './store'

// Holds all app state and wires it to on-device persistence. Grows per Phase 1
// task (repo/branch/tree/open-file come later); P1-T1 handles the PAT + view.
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  const [tokenLoaded, setTokenLoaded] = useState(false)
  const [view, setView] = useState<View>('editor')

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
      view,
      setView,
    }),
    [token, tokenLoaded, view],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
