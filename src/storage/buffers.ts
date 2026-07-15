import type { OpenFile, RepoRef } from '../state/store'

// OPFS-backed cache of the current editing session (P1-T8). Persists the open
// file + its working buffer so a full PWA reload (or Safari's ~7-day eviction
// nudge) doesn't lose unsaved work. GitHub stays the source of truth — this is a
// disposable cache (DECISIONS 🔒 3/9), so every failure here is non-fatal.
const SESSION_FILE = 'session.json'

// A snapshot of what the user is editing, enough to fully restore the editor
// (repo/branch context + the open file baseline + the unsaved buffer).
export interface EditSession {
  repo: RepoRef
  branch: string
  file: OpenFile
  buffer: string
}

function opfsRoot(): Promise<FileSystemDirectoryHandle> | null {
  // Feature-detect: older/edge browsers may lack OPFS. Missing → skip caching.
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  return navigator.storage.getDirectory()
}

export async function saveSession(session: EditSession): Promise<void> {
  const root = opfsRoot()
  if (!root) return
  try {
    const dir = await root
    const handle = await dir.getFileHandle(SESSION_FILE, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(session))
    await writable.close()
  } catch {
    // OPFS write unavailable (e.g. no createWritable) — resilience is best-effort.
  }
}

export async function loadSession(): Promise<EditSession | undefined> {
  const root = opfsRoot()
  if (!root) return undefined
  try {
    const dir = await root
    const handle = await dir.getFileHandle(SESSION_FILE)
    const text = await (await handle.getFile()).text()
    return text ? (JSON.parse(text) as EditSession) : undefined
  } catch {
    // Not found or unreadable — nothing to restore.
    return undefined
  }
}

export async function clearSession(): Promise<void> {
  const root = opfsRoot()
  if (!root) return
  try {
    await (await root).removeEntry(SESSION_FILE)
  } catch {
    // Already gone — fine.
  }
}
