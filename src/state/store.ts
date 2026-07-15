import { createContext, useContext } from 'react'
import type { GitHubClient, GitHubUser } from '../github/client'

// Which top-level screen is showing. Kept as simple state (no router) — the app
// is a small view switch, and GitHub Pages sub-path routing is avoided entirely.
export type View = 'settings' | 'browse' | 'editor'

// Result of validating the PAT against GET /user (P1-T2).
export type AuthState = 'idle' | 'checking' | 'valid' | 'invalid'

export interface Store {
  // --- auth / PAT (P1-T1) ---
  // In-memory copy of the on-device PAT for the session, used only to build the
  // GitHub Authorization header. `null` = no token stored. Never logged.
  token: string | null
  // False until the initial IndexedDB read resolves, so the UI can avoid a
  // settings/editor flash before we know whether a token exists.
  tokenLoaded: boolean
  saveToken: (pat: string) => Promise<void>
  removeToken: () => Promise<void>

  // --- GitHub client + auth validation (P1-T2) ---
  // Client bound to the current token; null when no token is stored. All GitHub
  // calls go through this.
  client: GitHubClient | null
  auth: AuthState
  user: GitHubUser | null
  authError: string | null

  // --- navigation ---
  view: View
  setView: (view: View) => void
}

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used within <StoreProvider>')
  return store
}
