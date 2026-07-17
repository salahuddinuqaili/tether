import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { isAbort, type ChatMessage as WireMessage } from '../llm/client'
import { buildSystemPrompt, runAgentTurn, type AgentContext } from '../llm/agent'
import { GitHubError } from '../github/client'
import { decodeBase64ToText } from '../lib/base64'
import { getModel, getOllamaUrl } from '../storage/llm'
import { useStore } from '../state/store'
import { appendStreaming, getStreamingText, resetStreaming } from './streaming'
import type { AgentStatus, UiMessage } from './types'

// Holds the conversation and drives the streaming agent turn. Mounted ABOVE the
// view switch (in App), so the chat survives navigating to the editor/diff and back.
// The hot streaming path never touches this state — token deltas go to the streaming
// store and re-render only the active bubble (SPEC §3). This state changes just a few
// times per turn (append user + placeholder, then finalize).

// A file the user manually attached for context (the @-attach fallback, SPEC §5.2):
// its content is injected into the next turn so the model sees it without having to
// call read_file (or guess the path).
export interface Attachment {
  path: string
  content: string
}

interface ChatContextValue {
  messages: UiMessage[]
  status: AgentStatus
  attachments: Attachment[]
  send: (text: string) => void
  stop: () => void
  clear: () => void
  retry: () => void
  attachFile: (path: string) => Promise<void>
  removeAttachment: (path: string) => void
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
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // Latest repo context + messages, read at send time without re-creating `send`.
  const { client, repo, branch, openFile, buffer } = useStore()
  const ctxRef = useRef({ client, repo, branch, openFile, buffer })
  ctxRef.current = { client, repo, branch, openFile, buffer }
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const abortRef = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)

  // read_file executor: pull any repo file for the agent via the Phase 1 GitHub
  // client. Errors become plain strings the model can reason about (never throws).
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

  const attachFile = useCallback(
    async (path: string) => {
      const clean = path.trim().replace(/^\/+/, '')
      if (!clean || attachmentsRef.current.some((a) => a.path === clean)) return
      const content = await readFile(clean)
      setAttachments((prev) =>
        prev.some((a) => a.path === clean) ? prev : [...prev, { path: clean, content }],
      )
    },
    [readFile],
  )

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  }, [])

  const finalize = useCallback((id: string, content: string, error: boolean) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, streaming: false, error } : m)),
    )
  }, [])

  // Runs the async agent turn for an already-appended assistant placeholder. Shared
  // by send() (fresh turn) and retry() (re-run the last turn). `history` is the
  // conversation BEFORE this user turn.
  const runAssistantTurn = useCallback(
    (userText: string, assistantId: string, history: UiMessage[]) => {
      sendingRef.current = true
      resetStreaming()
      setStatus('streaming')
      void (async () => {
        const controller = new AbortController()
        abortRef.current = controller
        try {
          const [url, model] = await Promise.all([getOllamaUrl(), getModel()])
          if (!url || !model) {
            finalize(
              assistantId,
              'No model is configured yet. Open Settings, enter your Ollama URL, test the connection, and pick a model.',
              true,
            )
            setStatus('error')
            return
          }

          const { repo: r, branch: b, openFile: f, buffer: buf } = ctxRef.current
          const agentCtx: AgentContext | null =
            r && b
              ? {
                  owner: r.owner,
                  name: r.name,
                  branch: b,
                  openFilePath: f?.path,
                  openFileContent: f ? buf : undefined,
                }
              : null

          // Consume any manually-attached files as context for this turn only.
          const atts = attachmentsRef.current
          setAttachments([])
          const attachMsg: WireMessage | null = atts.length
            ? {
                role: 'user',
                content:
                  'Files attached for context:\n\n' +
                  atts
                    .map((a) => `### ${a.path}\n\`\`\`\n${a.content.slice(0, MAX_ATTACH_CHARS)}\n\`\`\``)
                    .join('\n\n'),
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
            url,
            model,
            messages: apiMessages,
            readFile,
            signal: controller.signal,
            onToken: appendStreaming,
            onRoundStart: resetStreaming,
            onStatus: (s) => setStatus(s),
          })
          finalize(assistantId, res.content, false)
          setStatus('idle')
        } catch (e) {
          if (isAbort(e)) {
            finalize(assistantId, getStreamingText(), false)
            setStatus('idle')
          } else {
            finalize(assistantId, e instanceof Error ? e.message : 'The model request failed.', true)
            setStatus('error')
          }
        } finally {
          abortRef.current = null
          resetStreaming()
          sendingRef.current = false
        }
      })()
    },
    [finalize, readFile],
  )

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || sendingRef.current) return

      const userMsg: UiMessage = { id: newId(), role: 'user', content: text }
      const assistantId = newId()
      const placeholder: UiMessage = { id: assistantId, role: 'assistant', content: '', streaming: true }
      const history = messagesRef.current

      // Instant, optimistic: append the user bubble + assistant placeholder in one
      // commit. The composer clears its own input on the same frame.
      setMessages((prev) => [...prev, userMsg, placeholder])
      runAssistantTurn(text, assistantId, history)
    },
    [runAssistantTurn],
  )

  // Re-run the last user turn after a failure (graceful degradation, P2-T7): drop the
  // failed assistant bubble and stream a fresh one against the same question — no
  // duplicate user bubble, so the transcript reads as if the turn just re-ran.
  const retry = useCallback(() => {
    if (sendingRef.current) return
    const msgs = messagesRef.current
    let i = msgs.length - 1
    while (i >= 0 && msgs[i].role !== 'user') i--
    if (i < 0) return
    const userText = msgs[i].content
    const history = msgs.slice(0, i)
    const assistantId = newId()
    setMessages([
      ...msgs.slice(0, i + 1),
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ])
    runAssistantTurn(userText, assistantId, history)
  }, [runAssistantTurn])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    resetStreaming()
    setMessages([])
    setAttachments([])
    setStatus('idle')
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({ messages, status, attachments, send, stop, clear, retry, attachFile, removeAttachment }),
    [messages, status, attachments, send, stop, clear, retry, attachFile, removeAttachment],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within <ChatProvider>')
  return ctx
}
