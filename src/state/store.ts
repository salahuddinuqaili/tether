import { createContext, useContext } from 'react'
import type { GitHubClient, GitHubUser } from '../github/client'

// Which top-level screen is showing. Kept as simple state (no router) — the app
// is a small view switch, and GitHub Pages sub-path routing is avoided entirely.
// `chat` is the chat-first home (D5); `editor` is the review/diff surface.
export type View = 'settings' | 'browse' | 'editor' | 'chat'

// Result of validating the PAT against GET /user (P1-T2).
export type AuthState = 'idle' | 'checking' | 'valid' | 'invalid'

// The repo the user is browsing/editing, plus its default branch (P1-T3).
export interface RepoRef {
  owner: string
  name: string
  defaultBranch: string
}

// A file open in the editor (P1-T5). `sha` is the blob sha held for committing;
// `baseContent` is the content as last known on GitHub — the dirty baseline and
// what a commit replaces.
export interface OpenFile {
  path: string
  name: string
  sha: string
  baseContent: string
}

// The remote file as it stands now, re-fetched after a 409 stale-sha commit
// (P1-T7). `remoteSha` is the current blob sha to commit against on retry.
export interface ShaConflict {
  remoteSha: string
  remoteContent: string
}

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

  // --- repo + branch selection (P1-T3) ---
  repo: RepoRef | null
  branch: string | null
  // Resolves the repo (validating access + discovering its default branch),
  // selects it, and preselects the default branch. Throws GitHubError on 404.
  selectRepo: (owner: string, name: string) => Promise<void>
  setBranch: (branch: string) => void
  clearRepo: () => void

  // --- open file + editor buffer (P1-T5/T6) ---
  openFile: OpenFile | null
  // Current editor contents; the source of truth for dirty state and commits.
  buffer: string
  openLoading: boolean
  openError: string | null
  // True when the buffer diverges from the file's GitHub baseline.
  dirty: boolean
  openFileFromGitHub: (path: string) => Promise<void>
  // Open `path` seeded with agent-proposed content so the buffer is dirty vs the
  // file's true remote baseline — surfacing the Phase 1 commit bar (P2-T5/T6). A
  // path that doesn't exist yet is treated as a new file (empty baseline, no sha).
  openProposedEdit: (path: string, newContent: string) => Promise<void>
  updateBuffer: (text: string) => void
  closeFile: () => void

  // --- commit (P1-T7) ---
  committing: boolean
  commitError: string | null
  // Set when a commit hits HTTP 409 because the held sha is stale (the file
  // changed on GitHub since it was opened). Carries the freshly re-fetched
  // remote state so the user can resolve it. Null when there is no conflict.
  conflict: ShaConflict | null
  // Commit the buffer with the held sha. Resolves true on success; on a 409 it
  // re-fetches the remote file, populates `conflict`, and resolves false.
  commitFile: (message: string) => Promise<boolean>
  // Conflict resolution: keep local edits and commit over the new remote sha.
  overwriteRemote: (message: string) => Promise<boolean>
  // Conflict resolution: drop local edits and load the latest remote content.
  discardAndReload: () => void

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
