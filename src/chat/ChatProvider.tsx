import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { chat, isAbort, type ChatMessage as WireMessage } from '../llm/client'
import { getModel, getOllamaUrl } from '../storage/llm'
import { appendStreaming, getStreamingText, resetStreaming } from './streaming'
import type { AgentStatus, UiMessage } from './types'

// Holds the conversation and drives the streaming turn. Mounted ABOVE the view
// switch (in App), so the chat survives navigating to the editor/diff and back.
// The hot streaming path never touches this state — token deltas go to the
// streaming store and re-render only the active bubble (SPEC §3). This state
// changes just a few times per turn (append user + placeholder, then finalize).

interface ChatContextValue {
  messages: UiMessage[]
  status: AgentStatus
  send: (text: string) => void
  stop: () => void
  clear: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

// Minimal T3 system prompt. P2-T4 replaces this with the repo/open-file-aware
// agent prompt (and the read_file tool loop).
const SYSTEM_PROMPT =
  'You are a coding assistant helping from a phone. Be concise and practical. Use fenced code blocks for code.'

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

  // Latest messages without re-creating `send`, so we can build the API history
  // from the pre-append conversation.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const abortRef = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)

  const finalize = useCallback((id: string, content: string, error: boolean) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content, streaming: false, error } : m)),
    )
  }, [])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || sendingRef.current) return
      sendingRef.current = true

      const userMsg: UiMessage = { id: newId(), role: 'user', content: text }
      const assistantId = newId()
      const placeholder: UiMessage = { id: assistantId, role: 'assistant', content: '', streaming: true }
      const history = messagesRef.current

      // Instant, optimistic: append the user bubble + assistant placeholder in one
      // commit. The composer clears its own input on the same frame.
      setMessages((prev) => [...prev, userMsg, placeholder])
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
            setStatus('idle')
            return
          }
          const apiMessages: WireMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history
              .filter((m) => !m.streaming && m.content && !m.error)
              .map((m) => ({ role: m.role, content: m.content }) satisfies WireMessage),
            { role: 'user', content: text },
          ]
          const res = await chat({
            url,
            model,
            messages: apiMessages,
            signal: controller.signal,
            onToken: appendStreaming,
          })
          finalize(assistantId, res.message.content, false)
          setStatus('idle')
        } catch (e) {
          if (isAbort(e)) {
            // Keep whatever streamed before the user hit stop.
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
    [finalize],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    resetStreaming()
    setMessages([])
    setStatus('idle')
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({ messages, status, send, stop, clear }),
    [messages, status, send, stop, clear],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within <ChatProvider>')
  return ctx
}
