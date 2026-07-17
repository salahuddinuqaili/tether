// Streaming Ollama chat client (P2-T2). Talks directly from the browser to the
// desktop model over the Tailscale Serve HTTPS endpoint — no backend. Reads the
// NDJSON /api/chat stream and emits content deltas as they arrive, so the chat can
// render token-by-token. Abortable via AbortSignal; can fall back to a single
// buffered response when asked. Endpoint + model are runtime config (D4), always
// passed in by the caller — nothing about the tailnet is baked in here.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  // An assistant turn may request tool calls (used by the agent loop, P2-T4).
  tool_calls?: ToolCall[]
  // A tool result names the tool it answers (Ollama tool messages).
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

export interface ChatParams {
  url: string
  model: string
  messages: ChatMessage[]
  tools?: Tool[]
  signal?: AbortSignal
  // Invoked with each streamed content delta (never called in non-streaming mode).
  onToken?: (delta: string) => void
  // Force a single buffered response instead of streaming. Defaults to streaming.
  stream?: boolean
  // Ask thinking-capable models (e.g. qwen3.x) to skip the reasoning channel, so the
  // answer streams into `content` (which we render) instead of `thinking`. Ignored by
  // models without a thinking mode. Omitted from the request when undefined.
  think?: boolean
}

export interface ChatResponse {
  // The fully assembled assistant message: content joined, tool_calls captured.
  message: ChatMessage
  // True when we actually read an incremental stream (vs a buffered response).
  streamed: boolean
}

// One NDJSON line from /api/chat.
interface OllamaChatChunk {
  message?: { role?: string; content?: string; tool_calls?: ToolCall[] }
  done?: boolean
  error?: string
}

export class OllamaError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.status = status
  }
}

export async function chat(params: ChatParams): Promise<ChatResponse> {
  const { url, model, messages, tools, signal, onToken, think } = params
  const stream = params.stream ?? true

  let res: Response
  try {
    res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream,
        ...(tools ? { tools } : {}),
        ...(think !== undefined ? { think } : {}),
      }),
      signal,
    })
  } catch (e) {
    if (isAbort(e)) throw e
    // Network / CORS / cert failure — the browser hides which behind an opaque
    // "Failed to fetch". Give a phone-friendly, actionable message instead.
    throw new OllamaError(
      'Could not reach your model. Check that your desktop is awake and the endpoint URL in Settings is correct.',
    )
  }

  if (!res.ok) {
    throw new OllamaError(`The model endpoint returned HTTP ${res.status}.`, res.status)
  }

  if (!stream || !res.body) {
    // Non-streaming fallback: a single JSON object carrying the whole message.
    const data = (await res.json()) as OllamaChatChunk
    if (data.error) throw new OllamaError(data.error)
    return { message: assembleMessage(data.message), streamed: false }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let toolCalls: ToolCall[] | undefined

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed) return
    let chunk: OllamaChatChunk
    try {
      chunk = JSON.parse(trimmed) as OllamaChatChunk
    } catch {
      return // ignore a malformed/partial line defensively
    }
    if (chunk.error) throw new OllamaError(chunk.error)
    const delta = chunk.message?.content ?? ''
    if (delta) {
      content += delta
      onToken?.(delta)
    }
    if (chunk.message?.tool_calls?.length) {
      toolCalls = [...(toolCalls ?? []), ...chunk.message.tool_calls]
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    }
    buffer += decoder.decode()
    handleLine(buffer)
  } finally {
    reader.releaseLock()
  }

  return {
    message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
    streamed: true,
  }
}

function assembleMessage(m: OllamaChatChunk['message']): ChatMessage {
  return {
    role: 'assistant',
    content: m?.content ?? '',
    ...(m?.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
  }
}

// True when an error is an AbortController abort (so callers can treat it as a
// user cancellation, not a failure).
export function isAbort(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError'
}
