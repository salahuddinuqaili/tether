// UI-facing chat types. Distinct from the normalized LLM types in
// src/llm/providers/types.ts: these carry a stable `id` (for memoized list
// rendering) and a `streaming` flag for the in-flight assistant bubble.

export type ChatRole = 'user' | 'assistant'

export interface UiMessage {
  id: string
  role: ChatRole
  content: string
  // True only for the single assistant bubble currently receiving tokens. Its text
  // is read from the streaming store (not `content`) until the turn finalizes.
  streaming?: boolean
  // Set when the turn ended in a transport/model error, so the bubble can style it.
  error?: boolean
}

// The agent's high-level status, surfaced in the header / typing indicator.
// 'reading' is the P2-T4 tool loop (agent pulling repo files); 'queued' (P3-T7) means
// a same-Ollama-box session is ahead of this one on the GPU — waiting, not stuck.
export type AgentStatus = 'idle' | 'queued' | 'streaming' | 'reading' | 'error'

// A file the user manually attached for context (the @-attach fallback, SPEC §5.2):
// its content is injected into the next turn so the model sees it without read_file.
export interface Attachment {
  path: string
  content: string
}

// One chat conversation (P3-T7). Multiple sessions run concurrently, each bound to
// its own {endpoint, model} and owning its own messages, status, AbortController, and
// streaming channel — no global singleton (SPEC §4.6).
export interface Session {
  id: string
  title: string
  // The endpoint (by id) + model this session talks to. Unset falls back to the
  // global default binding (Settings) when a turn runs.
  endpointId?: string
  model?: string
  messages: UiMessage[]
  status: AgentStatus
  attachments: Attachment[]
}
