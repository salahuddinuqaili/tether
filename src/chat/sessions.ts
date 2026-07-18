import { idbGet, idbSet } from '../lib/idb'
import type { Session } from './types'

// Session persistence (P3-T7). Sessions survive reload so open chats aren't lost.
// Stored in IndexedDB (like the endpoint config + PAT) rather than OPFS — the data
// is small structured JSON, and idb already handles it. The snapshot is sanitized:
// a stream can't survive a reload, so in-flight placeholders + transient attachments
// are dropped and any non-error status resets to idle.
const SESSIONS_KEY = 'chat_sessions'
const ACTIVE_SESSION_KEY = 'active_session_id'

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

// A short title from the first user message; a fresh chat until then.
export function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 40 ? `${t.slice(0, 40)}…` : t || 'New chat'
}

export function createSession(binding?: { endpointId?: string; model?: string }): Session {
  return {
    id: newSessionId(),
    title: 'New chat',
    endpointId: binding?.endpointId,
    model: binding?.model,
    messages: [],
    status: 'idle',
    attachments: [],
  }
}

export async function saveSessions(sessions: Session[], activeId: string): Promise<void> {
  const clean: Session[] = sessions.map((s) => ({
    ...s,
    status: s.status === 'error' ? 'error' : 'idle',
    // Drop the in-flight streaming placeholder (its text lives in a channel that
    // dies with the page) and transient attachments.
    messages: s.messages.filter((m) => !m.streaming),
    attachments: [],
  }))
  await idbSet(SESSIONS_KEY, clean)
  await idbSet(ACTIVE_SESSION_KEY, activeId)
}

export async function loadSessions(): Promise<{ sessions: Session[]; activeId?: string }> {
  const [sessions, activeId] = await Promise.all([
    idbGet<Session[]>(SESSIONS_KEY),
    idbGet<string>(ACTIVE_SESSION_KEY),
  ])
  return { sessions: sessions ?? [], activeId: activeId || undefined }
}
