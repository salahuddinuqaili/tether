import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createProvider, isAbort, type ChatMessage as WireMessage, type EndpointConfig } from '../llm/providers'
import { buildSystemPrompt, runAgentTurn, type AgentContext } from '../llm/agent'
import { GitHubError } from '../github/client'
import { decodeBase64ToText } from '../lib/base64'
import {
  getActiveBinding,
  getEndpoints,
  migrateLegacyOllama,
  setActiveEndpointId,
  setActiveModelForEndpoint,
} from '../storage/providers'
import { useStore } from '../state/store'
import { appendStreaming, disposeStreaming, getStreamingText, resetStreaming } from './streaming'
import { createSession, deriveTitle, loadSessions, saveSessions } from './sessions'
import type { Attachment, Session, UiMessage } from './types'

// Holds ALL chat sessions and drives their streaming agent turns (P3-T7,
// generalizing D9). Each session owns its own messages, status, AbortController, and
// streaming channel (src/chat/streaming.ts, keyed by session id) — so two sessions on
// different endpoints stream in parallel and per-token deltas re-render ONLY the
// active bubble (SPEC §3), never the whole list or the other sessions. Session state
// changes just a few times per turn (append, status, finalize); the hot token path
// never touches this state.

export type { Attachment } from './types'

interface ChatContextValue {
  // --- active session view ---
  activeSessionId: string
  messages: UiMessage[]
  status: Session['status']
  attachments: Attachment[]
  // The active session's {endpoint, model} binding — the chat-page picker reads/writes this.
  binding: { endpointId?: string; model?: string }
  setBinding: (endpointId: string, model: string) => void
  // --- all sessions (for the switcher) ---
  sessions: Session[]
  // --- message ops (act on the active session) ---
  send: (text: string) => void
  stop: () => void
  clear: () => void
  retry: () => void
  attachFile: (path: string) => Promise<void>
  removeAttachment: (path: string) => void
  // --- session ops ---
  newSession: () => void
  switchSession: (id: string) => void
  closeSession: (id: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

// Cap injected context so large files don't blow the model's window (SPEC risk #3).
const MAX_ATTACH_CHARS = 8000

let idCounter = 0
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `m${Date.now()}_${idCounter++}`
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Latest repo context (shared by all sessions — the app has one selected repo),
  // read at send time without re-creating callbacks.
  const { client, repo, branch, openFile, buffer } = useStore()
  const ctxRef = useRef({ client, repo, branch, openFile, buffer })
  ctxRef.current = { client, repo, branch, openFile, buffer }

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const activeIdRef = useRef(activeSessionId)
  activeIdRef.current = activeSessionId

  // Per-session in-flight bookkeeping (refs, not state — the UI reads session.status).
  const abortMap = useRef(new Map<string, AbortController>())
  const sendingMap = useRef(new Map<string, boolean>())
  // Ollama base URLs with an in-flight stream, for the queued indicator (a same-box
  // second session serializes on the GPU).
  const busyOllama = useRef(new Map<string, number>())
  // Warm caches so queued detection runs SYNCHRONOUSLY (before any await) — otherwise
  // two near-simultaneous same-box sends could both read busyOllama===0. Kept fresh by
  // the load effect, resolveBinding, and setBinding.
  const endpointsRef = useRef<EndpointConfig[]>([])
  const activeEndpointIdRef = useRef<string | undefined>(undefined)

  const updateSession = useCallback((id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))
  }, [])

  // Load persisted sessions (or seed one from the global default binding) on mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await migrateLegacyOllama() // Phase 2 install → an endpoint (P3-T2)
      const [{ sessions: loadedSessions, activeId }, fallback, eps] = await Promise.all([
        loadSessions(),
        getActiveBinding(),
        getEndpoints(),
      ])
      if (cancelled) return
      endpointsRef.current = eps
      activeEndpointIdRef.current = fallback?.endpoint.id
      if (loadedSessions.length > 0) {
        setSessions(loadedSessions)
        setActiveSessionId(loadedSessions.find((s) => s.id === activeId)?.id ?? loadedSessions[0].id)
      } else {
        const first = createSession({ endpointId: fallback?.endpoint.id, model: fallback?.model })
        setSessions([first])
        setActiveSessionId(first.id)
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Persist sessions (debounced) once the initial load has run.
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void saveSessions(sessionsRef.current, activeIdRef.current), 500)
    return () => clearTimeout(t)
  }, [sessions, activeSessionId, loaded])

  // read_file executor: pull any repo file for the agent via the Phase 1 GitHub
  // client (shared across sessions). Errors become plain strings, never throws.
  const readFile = useCallback(async (path: string): Promise<string> => {
    const { client: c, repo: r, branch: b } = ctxRef.current
    if (!c || !r || !b) return 'No repository is selected in tether.'
    const clean = path.trim().replace(/^\/+/, '')
    try {
      const file = await c.getContents(r.owner, r.name, clean, b)
      if (file.type !== 'file' || file.encoding !== 'base64' || file.content === undefined) {
        return `Cannot read "${clean}" — not a readable text file under 1MB.`
      }
      return decodeBase64ToText(file.content)
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return `File not found: ${clean}`
      return `Could not read "${clean}": ${e instanceof Error ? e.message : 'error'}`
    }
  }, [])

  // Resolve the session's endpoint + model. If the session's endpoint is missing
  // (unset or deleted) fall back to the global default for BOTH. If the endpoint is
  // known but the model isn't, use that endpoint's OWN remembered model — never a
  // different endpoint's model (which would be an invalid pairing).
  const resolveBinding = useCallback(
    async (session: Session): Promise<{ endpoint: EndpointConfig; model: string } | null> => {
      const endpoints = await getEndpoints()
      endpointsRef.current = endpoints // keep the sync queued-detection cache warm
      let endpoint = session.endpointId ? endpoints.find((e) => e.id === session.endpointId) : undefined
      let model = session.model
      if (!endpoint) {
        const fallback = await getActiveBinding()
        endpoint = fallback?.endpoint
        model = model ?? fallback?.model
      } else if (!model) {
        model = endpoint.model
      }
      return endpoint && model ? { endpoint, model } : null
    },
    [],
  )

  const finalize = useCallback(
    (sessionId: string, msgId: string, content: string, error: boolean) => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === msgId ? { ...m, content, streaming: false, error } : m)),
      }))
    },
    [updateSession],
  )

  const setStatus = useCallback(
    (sessionId: string, status: Session['status']) => updateSession(sessionId, (s) => ({ ...s, status })),
    [updateSession],
  )

  // Run the async agent turn for an already-appended assistant placeholder in a
  // specific session. Shared by send() and retry(). `history` is the conversation
  // BEFORE this user turn.
  const runAssistantTurn = useCallback(
    (sessionId: string, userText: string, assistantId: string, history: UiMessage[]) => {
      sendingMap.current.set(sessionId, true)
      resetStreaming(sessionId)

      // Queued detection must run SYNCHRONOUSLY (before any await) so two same-box
      // sends can't both read busyOllama===0. Increment here; the finally decrements
      // the same key. Uses the warm endpoints cache; a session with no pinned endpoint
      // falls back to the global default id.
      const preSession = sessionsRef.current.find((s) => s.id === sessionId)
      const preEndpointId = preSession?.endpointId ?? activeEndpointIdRef.current
      const preEndpoint = preEndpointId ? endpointsRef.current.find((e) => e.id === preEndpointId) : undefined
      const ollamaUrl = preEndpoint?.kind === 'ollama' ? preEndpoint.baseUrl : null
      let queued = false
      if (ollamaUrl) {
        queued = (busyOllama.current.get(ollamaUrl) ?? 0) > 0
        busyOllama.current.set(ollamaUrl, (busyOllama.current.get(ollamaUrl) ?? 0) + 1)
      }
      setStatus(sessionId, queued ? 'queued' : 'streaming')

      void (async () => {
        const controller = new AbortController()
        abortMap.current.set(sessionId, controller)
        try {
          const session = sessionsRef.current.find((s) => s.id === sessionId)
          if (!session) return
          const resolved = await resolveBinding(session)
          if (!resolved) {
            finalize(
              sessionId,
              assistantId,
              'No model endpoint is configured yet. Open Settings, add an endpoint, and pick a model.',
              true,
            )
            setStatus(sessionId, 'error')
            return
          }
          const { endpoint, model } = resolved
          const provider = createProvider(endpoint)

          // Global repo context (shared across sessions).
          const { repo: r, branch: b, openFile: f, buffer: buf } = ctxRef.current
          const agentCtx: AgentContext | null =
            r && b
              ? { owner: r.owner, name: r.name, branch: b, openFilePath: f?.path, openFileContent: f ? buf : undefined }
              : null

          // Consume this session's manually-attached files as context for this turn.
          const atts = session.attachments
          if (atts.length) updateSession(sessionId, (s) => ({ ...s, attachments: [] }))
          const attachMsg: WireMessage | null = atts.length
            ? {
                role: 'user',
                content:
                  'Files attached for context:\n\n' +
                  atts.map((a) => `### ${a.path}\n\`\`\`\n${a.content.slice(0, MAX_ATTACH_CHARS)}\n\`\`\``).join('\n\n'),
              }
            : null

          const apiMessages: WireMessage[] = [
            { role: 'system', content: buildSystemPrompt(agentCtx) },
            ...history
              .filter((m) => !m.streaming && m.content && !m.error)
              .map((m) => ({ role: m.role, content: m.content }) satisfies WireMessage),
            ...(attachMsg ? [attachMsg] : []),
            { role: 'user', content: userText },
          ]

          const res = await runAgentTurn({
            provider,
            model,
            messages: apiMessages,
            readFile,
            signal: controller.signal,
            onToken: (d) => {
              if (queued) {
                queued = false
                setStatus(sessionId, 'streaming')
              }
              appendStreaming(sessionId, d)
            },
            onRoundStart: () => resetStreaming(sessionId),
            onStatus: (st) => {
              // Reaching a read round proves the request was serviced → not queued.
              if (st === 'reading') queued = false
              setStatus(sessionId, queued && st === 'streaming' ? 'queued' : st)
            },
          })
          finalize(sessionId, assistantId, res.content, false)
          setStatus(sessionId, 'idle')
        } catch (e) {
          if (isAbort(e)) {
            finalize(sessionId, assistantId, getStreamingText(sessionId), false)
            setStatus(sessionId, 'idle')
          } else {
            finalize(sessionId, assistantId, e instanceof Error ? e.message : 'The model request failed.', true)
            setStatus(sessionId, 'error')
          }
        } finally {
          abortMap.current.delete(sessionId)
          sendingMap.current.delete(sessionId)
          if (ollamaUrl) {
            busyOllama.current.set(ollamaUrl, Math.max(0, (busyOllama.current.get(ollamaUrl) ?? 1) - 1))
          }
          // If the session was closed mid-turn, dispose its streaming channel (a late
          // buffered token after abort may have re-created it via appendStreaming);
          // otherwise just reset it for the next turn.
          if (sessionsRef.current.some((s) => s.id === sessionId)) resetStreaming(sessionId)
          else disposeStreaming(sessionId)
        }
      })()
    },
    [finalize, readFile, resolveBinding, setStatus, updateSession],
  )

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      const sessionId = activeIdRef.current
      if (!text || sendingMap.current.get(sessionId)) return
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) return

      const userMsg: UiMessage = { id: newId(), role: 'user', content: text }
      const assistantId = newId()
      const placeholder: UiMessage = { id: assistantId, role: 'assistant', content: '', streaming: true }
      const history = session.messages

      // Optimistic: append user + placeholder and title the chat from the first message.
      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? deriveTitle(text) : s.title,
        messages: [...s.messages, userMsg, placeholder],
      }))
      runAssistantTurn(sessionId, text, assistantId, history)
    },
    [runAssistantTurn, updateSession],
  )

  // Re-run the active session's last user turn after a failure (P2-T7): drop the
  // failed assistant bubble and stream a fresh one against the same question.
  const retry = useCallback(() => {
    const sessionId = activeIdRef.current
    if (sendingMap.current.get(sessionId)) return
    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session) return
    const msgs = session.messages
    let i = msgs.length - 1
    while (i >= 0 && msgs[i].role !== 'user') i--
    if (i < 0) return
    const userText = msgs[i].content
    const history = msgs.slice(0, i)
    const assistantId = newId()
    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...msgs.slice(0, i + 1), { id: assistantId, role: 'assistant', content: '', streaming: true }],
    }))
    runAssistantTurn(sessionId, userText, assistantId, history)
  }, [runAssistantTurn, updateSession])

  const stop = useCallback(() => {
    abortMap.current.get(activeIdRef.current)?.abort()
  }, [])

  const clear = useCallback(() => {
    const sessionId = activeIdRef.current
    abortMap.current.get(sessionId)?.abort()
    resetStreaming(sessionId)
    updateSession(sessionId, (s) => ({ ...s, messages: [], attachments: [], status: 'idle', title: 'New chat' }))
  }, [updateSession])

  const attachFile = useCallback(
    async (path: string) => {
      const sessionId = activeIdRef.current
      const clean = path.trim().replace(/^\/+/, '')
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!clean || !session || session.attachments.some((a) => a.path === clean)) return
      const content = await readFile(clean)
      updateSession(sessionId, (s) =>
        s.attachments.some((a) => a.path === clean) ? s : { ...s, attachments: [...s.attachments, { path: clean, content }] },
      )
    },
    [readFile, updateSession],
  )

  const removeAttachment = useCallback(
    (path: string) => {
      updateSession(activeIdRef.current, (s) => ({ ...s, attachments: s.attachments.filter((a) => a.path !== path) }))
    },
    [updateSession],
  )

  const setBinding = useCallback(
    (endpointId: string, model: string) => {
      updateSession(activeIdRef.current, (s) => ({ ...s, endpointId, model }))
      activeEndpointIdRef.current = endpointId
      // Also record as the global default so new sessions inherit it.
      void setActiveEndpointId(endpointId)
      void setActiveModelForEndpoint(endpointId, model)
    },
    [updateSession],
  )

  const newSession = useCallback(() => {
    const active = sessionsRef.current.find((s) => s.id === activeIdRef.current)
    const s = createSession({ endpointId: active?.endpointId, model: active?.model })
    setSessions((prev) => [...prev, s])
    setActiveSessionId(s.id)
  }, [])

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const closeSession = useCallback((id: string) => {
    abortMap.current.get(id)?.abort()
    abortMap.current.delete(id)
    sendingMap.current.delete(id)
    disposeStreaming(id)
    const remaining = sessionsRef.current.filter((s) => s.id !== id)
    if (remaining.length === 0) {
      const fresh = createSession()
      setSessions([fresh])
      setActiveSessionId(fresh.id)
    } else {
      setSessions(remaining)
      if (activeIdRef.current === id) setActiveSessionId(remaining[0].id)
    }
  }, [])

  const active = useMemo(() => sessions.find((s) => s.id === activeSessionId), [sessions, activeSessionId])

  const value = useMemo<ChatContextValue>(
    () => ({
      activeSessionId,
      messages: active?.messages ?? [],
      status: active?.status ?? 'idle',
      attachments: active?.attachments ?? [],
      binding: { endpointId: active?.endpointId, model: active?.model },
      setBinding,
      sessions,
      send,
      stop,
      clear,
      retry,
      attachFile,
      removeAttachment,
      newSession,
      switchSession,
      closeSession,
    }),
    [
      activeSessionId,
      active,
      sessions,
      setBinding,
      send,
      stop,
      clear,
      retry,
      attachFile,
      removeAttachment,
      newSession,
      switchSession,
      closeSession,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within <ChatProvider>')
  return ctx
}
