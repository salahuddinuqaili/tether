// UI-facing chat types. Distinct from the wire types in src/llm/client.ts: these
// carry a stable `id` (for memoized list rendering) and a `streaming` flag for the
// in-flight assistant bubble.

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
// 'reading' is used by the P2-T4 tool loop (agent pulling repo files for context).
export type AgentStatus = 'idle' | 'streaming' | 'reading' | 'error'
