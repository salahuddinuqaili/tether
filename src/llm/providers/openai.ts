// OpenAI-compatible adapter (P3-T3) — OpenRouter first, but any OpenAI-compatible
// /chat/completions endpoint. Owns the OpenAI wire format: SSE `data:` frames,
// tool-call deltas assembled by index, and the message translation that turns the
// agent loop's normalized shapes into OpenAI messages (synthesizing the
// tool_call_id ↔ tool.tool_call_id links the wire requires, from the positional
// pairing the agent loop guarantees — see ToolCall in types.ts). The agent loop
// stays format-blind; all of that lives here.

import {
  ProviderError,
  isAbort,
  type ChatMessage,
  type ChatResponse,
  type Provider,
  type ProviderChatParams,
  type ToolCall,
} from './types'

export interface OpenAIConfig {
  // e.g. https://openrouter.ai/api/v1 (trailing slash already stripped by storage).
  baseUrl: string
  apiKey?: string
}

export function createOpenAIProvider(config: OpenAIConfig): Provider {
  return {
    kind: 'openai',
    chat: (params) => openaiChat(config, params),
    listModels: (signal) => listOpenAIModels(config, signal),
  }
}

// --- outbound: normalized messages → OpenAI wire messages -------------------

interface OAIToolCallWire {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
type OAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCallWire[] }
  | { role: 'tool'; tool_call_id: string; content: string }

// Translate the agent loop's normalized messages to OpenAI's. OpenAI requires each
// assistant tool_call to carry an `id` that the following tool result echoes as
// `tool_call_id`. The normalized ToolCall has no id, so we mint stable ids and pair
// them POSITIONALLY: the tool results immediately after an assistant-with-tool_calls
// answer its calls in order (the invariant runAgentTurn guarantees).
export function toOpenAIMessages(messages: ChatMessage[]): OAIMessage[] {
  const out: OAIMessage[] = []
  let pendingIds: string[] = [] // ids of the last assistant turn's calls, awaiting results
  let resultIdx = 0

  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = m.tool_calls.map((_, i) => `call_${out.length}_${i}`)
      out.push({
        role: 'assistant',
        content: m.content ? m.content : null,
        tool_calls: m.tool_calls.map((c, i) => ({
          id: ids[i],
          type: 'function',
          function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) },
        })),
      })
      pendingIds = ids
      resultIdx = 0
    } else if (m.role === 'tool') {
      const id = pendingIds[resultIdx] ?? `call_orphan_${out.length}`
      resultIdx++
      out.push({ role: 'tool', tool_call_id: id, content: m.content })
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

// --- inbound: streamed tool-call delta accumulation --------------------------

interface OAIToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

// Assemble tool-call fragments that arrive across many SSE deltas, keyed by index.
class ToolCallAssembler {
  private byIndex = new Map<number, { name: string; args: string }>()

  add(deltas: OAIToolCallDelta[] | undefined): void {
    if (!deltas) return
    for (const d of deltas) {
      const acc = this.byIndex.get(d.index) ?? { name: '', args: '' }
      if (d.function?.name) acc.name = d.function.name
      if (d.function?.arguments) acc.args += d.function.arguments
      this.byIndex.set(d.index, acc)
    }
  }

  // Finalize into normalized ToolCalls (arguments parsed from the assembled JSON
  // string; a malformed/empty string yields {} so the agent loop reasons about it
  // rather than throwing).
  finish(): ToolCall[] {
    const calls: ToolCall[] = []
    for (const index of [...this.byIndex.keys()].sort((a, b) => a - b)) {
      const acc = this.byIndex.get(index)!
      if (!acc.name) continue
      calls.push({ function: { name: acc.name, arguments: parseArgs(acc.args) } })
    }
    return calls
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  const s = raw.trim()
  if (!s) return {}
  try {
    const obj = JSON.parse(s)
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// --- the chat call -----------------------------------------------------------

interface OAIStreamChunk {
  choices?: Array<{ delta?: { content?: string; tool_calls?: OAIToolCallDelta[] } }>
  error?: { message?: string }
}
interface OAICompletion {
  choices?: Array<{
    message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }
  }>
  error?: { message?: string }
}

async function openaiChat(config: OpenAIConfig, params: ProviderChatParams): Promise<ChatResponse> {
  const { model, messages, tools, signal, onToken } = params
  const stream = params.stream ?? true

  let res: Response
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(messages),
        stream,
        ...(tools ? { tools } : {}), // our Tool shape is already OpenAI-shaped
      }),
      signal,
    })
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ProviderError(
      'Could not reach the provider. Check your network and that the endpoint URL + API key in Settings are correct.',
    )
  }

  if (!res.ok) {
    throw new ProviderError(await errorMessage(res), res.status)
  }

  if (!stream || !res.body) {
    const data = (await res.json()) as OAICompletion
    if (data.error) throw new ProviderError(data.error.message ?? 'Provider error.')
    const choice = data.choices?.[0]?.message
    const toolCalls = (choice?.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c) => ({ function: { name: c.function!.name!, arguments: parseArgs(c.function!.arguments ?? '') } }))
    return {
      message: { role: 'assistant', content: choice?.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      streamed: false,
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const tools_ = new ToolCallAssembler()

  // Handle one SSE line. Frames are `data: <json>` (or `data: [DONE]`); other lines
  // (event:, comments, blanks) are ignored.
  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let chunk: OAIStreamChunk
    try {
      chunk = JSON.parse(data) as OAIStreamChunk
    } catch {
      return // ignore a malformed/partial frame defensively
    }
    if (chunk.error) throw new ProviderError(chunk.error.message ?? 'Provider streamed an error.')
    const delta = chunk.choices?.[0]?.delta
    if (delta?.content) {
      content += delta.content
      onToken?.(delta.content)
    }
    tools_.add(delta?.tool_calls)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE frames are newline-delimited; a frame may be split across reads.
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

  const toolCalls = tools_.finish()
  return {
    message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    streamed: true,
  }
}

// Best-effort extraction of a provider error message from a non-2xx body.
async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as OAICompletion
    if (data.error?.message) return `${data.error.message} (HTTP ${res.status})`
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401) return 'The provider rejected the API key (HTTP 401). Check the key in Settings.'
  return `The provider returned HTTP ${res.status}.`
}

// Model discovery: GET {baseUrl}/models → { data: [{ id }] } (OpenRouter/OpenAI).
export async function listOpenAIModels(config: OpenAIConfig, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${config.baseUrl}/models`, {
    method: 'GET',
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    signal,
  })
  if (!res.ok) throw new ProviderError(await errorMessage(res), res.status)
  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
}
