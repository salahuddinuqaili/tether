// Provider-agnostic LLM types + the Provider interface (P3-T1, DECISIONS D11).
// The agent loop (src/llm/agent.ts) speaks ONLY these normalized shapes; each
// adapter (ollama, openai, anthropic) owns its own wire format, stream framing,
// and tool-call shape, translating to and from here. Keeping the agent loop
// format-blind is the keystone of the multi-provider pivot — one loop, many
// endpoints, no per-provider branching leaking upward.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

// A normalized tool call: a name plus already-parsed argument object. Adapters
// that carry arguments as a JSON string on the wire (OpenAI) parse them here, so
// the agent loop never sees a provider's raw shape. There is deliberately NO call
// `id` field: Ollama's wire carries none, so the agent loop pairs a tool call with
// its result POSITIONALLY (see runAgentTurn). Adapters whose wire needs matching
// ids (OpenAI `tool_call_id`, Anthropic `tool_use_id`) synthesize them from that
// ordering when serializing — the id stays a wire concern, never leaks upward.
export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  // An assistant turn may request tool calls (the read_file loop, D10).
  tool_calls?: ToolCall[]
  // A tool result names the tool it answers.
  tool_name?: string
}

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// Per-call chat params. The endpoint (baseUrl / apiKey / kind) is baked into the
// Provider instance; only the model varies per call (the chat-page picker and,
// later, per-session bindings change it between messages).
export interface ProviderChatParams {
  model: string
  messages: ChatMessage[]
  tools?: Tool[]
  signal?: AbortSignal
  // Invoked with each streamed content delta (never called in non-streaming mode).
  onToken?: (delta: string) => void
  // Force a single buffered response instead of streaming. Defaults to streaming.
  stream?: boolean
  // Ollama-only hint: ask thinking-capable models to skip the reasoning channel so
  // the answer streams into `content`. Cloud adapters ignore it.
  think?: boolean
}

export interface ChatResponse {
  // The fully assembled assistant message: content joined, tool_calls normalized.
  message: ChatMessage
  // True when an incremental stream was actually read (vs a buffered response).
  streamed: boolean
}

// One configured LLM endpoint. Built from an EndpointConfig (P3-T2) and owns the
// wire format for its family. `kind` lets the UI or agent branch on provider
// family in the rare places that must (e.g. same-box GPU serialization).
export interface Provider {
  readonly kind: 'ollama' | 'openai' | 'anthropic'
  chat(params: ProviderChatParams): Promise<ChatResponse>
  // Discover selectable models (Ollama /api/tags, OpenAI /v1/models, a curated
  // list for Anthropic). Returns [] when the endpoint is not enumerable.
  listModels(signal?: AbortSignal): Promise<string[]>
}

// Transport / provider error carrying a phone-friendly message and, when known,
// the HTTP status. Adapters translate opaque fetch failures into these so the UI
// can show something actionable instead of "Failed to fetch".
export class ProviderError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

// True when an error is an AbortController abort (so callers can treat it as a
// user cancellation, not a failure). Provider-agnostic.
export function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}
