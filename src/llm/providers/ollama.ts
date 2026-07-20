// Ollama adapter (P3-T1) — the refactor of the former src/llm/client.ts and
// src/llm/tags.ts behind the Provider interface. Owns Ollama's wire format: the
// NDJSON /api/chat stream, the `think` flag, Ollama's native tool-call shape, and
// /api/tags model discovery. The endpoint is runtime config (D4), passed in by the
// caller — nothing about the tailnet is baked in here. Behavior is byte-for-byte
// the Phase 2 client; only the packaging changed.

import {
  ProviderError,
  isAbort,
  type ChatMessage,
  type ChatResponse,
  type Provider,
  type ProviderChatParams,
  type ToolCall,
} from './types'

export interface OllamaConfig {
  // Trailing-slash-normalized base URL (as storage stores it), e.g.
  // https://your-machine.your-tailnet.ts.net
  baseUrl: string
}

// Build an Ollama-backed Provider. The base URL is captured here so `chat` and
// `listModels` match the Provider interface (endpoint fixed, model per-call).
export function createOllamaProvider(config: OllamaConfig): Provider {
  return {
    kind: 'ollama',
    chat: (params) => ollamaChat(config.baseUrl, params),
    listModels: (signal) => listOllamaModels(config.baseUrl, signal),
  }
}

// One NDJSON line from /api/chat.
interface OllamaChatChunk {
  message?: { role?: string; content?: string; tool_calls?: ToolCall[] }
  done?: boolean
  error?: string
}

async function ollamaChat(url: string, params: ProviderChatParams): Promise<ChatResponse> {
  const { model, messages, tools, signal, onToken, think } = params
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
    throw new ProviderError(
      'Could not reach your model. Check that your desktop is awake and the endpoint URL in Settings is correct.',
    )
  }

  if (!res.ok) {
    throw new ProviderError(`The model endpoint returned HTTP ${res.status}.`, res.status)
  }

  if (!stream || !res.body) {
    // Non-streaming fallback: a single JSON object carrying the whole message.
    const data = (await res.json()) as OllamaChatChunk
    if (data.error) throw new ProviderError(data.error)
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
    if (chunk.error) throw new ProviderError(chunk.error)
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

// Ollama model discovery (GET /api/tags). Exported standalone as well because
// Settings' connection test uses it directly (a reachability probe that doubles
// as the model list). `url` must already be trailing-slash-normalized. Throws on
// network / CORS / non-2xx so callers can surface the transport failure verbatim.
export async function listOllamaModels(url: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${url}/api/tags`, { method: 'GET', signal })
  if (!res.ok) throw new ProviderError(`Endpoint answered HTTP ${res.status}.`, res.status)
  const data = (await res.json()) as { models?: Array<{ name: string }> }
  return (data.models ?? []).map((m) => m.name)
}
