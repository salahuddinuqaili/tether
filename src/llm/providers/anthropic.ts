// Anthropic Messages adapter (P3-T4) — the Claude API, called browser-direct with
// the `anthropic-dangerous-direct-browser-access` header (S-P3-2 confirmed the CORS
// preflight passes from the PWA origin). Owns Anthropic's wire format, which differs
// from OpenAI on every axis: the system prompt is a top-level field (not a message),
// tool results are `user` messages with tool_result blocks (not a `tool` role), and
// the SSE stream is a sequence of typed events (content_block_delta with text_delta /
// input_json_delta). All of that is translated here; the agent loop stays format-blind.

import {
  ProviderError,
  isAbort,
  type ChatMessage,
  type ChatResponse,
  type Provider,
  type ProviderChatParams,
  type Tool,
  type ToolCall,
} from './types'

export interface AnthropicConfig {
  baseUrl: string // https://api.anthropic.com (trailing slash stripped by storage)
  apiKey?: string
}

const ANTHROPIC_VERSION = '2023-06-01'
// Anthropic requires max_tokens; a generous default for chat/edit turns.
const DEFAULT_MAX_TOKENS = 4096
// Shown when /v1/models can't be reached (offline / CORS) — a small current set.
const CURATED_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
]

export function createAnthropicProvider(config: AnthropicConfig): Provider {
  return {
    kind: 'anthropic',
    chat: (params) => anthropicChat(config, params),
    listModels: (signal) => listAnthropicModels(config, signal),
  }
}

function browserHeaders(apiKey?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  }
}

// --- outbound: normalized messages → Anthropic (system + messages) ------------

interface ATextBlock { type: 'text'; text: string }
interface AToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }
type ABlock = ATextBlock | AToolUseBlock | AToolResultBlock
interface AMessage {
  role: 'user' | 'assistant'
  content: string | ABlock[]
}

// Anthropic has no `system` or `tool` role: system prompts move to a top-level
// field, and tool results become a `user` message of tool_result blocks. The agent
// loop's positional pairing (assistant tool_calls[i] answered by the i-th following
// tool message) lets us reconstruct the tool_use_id ↔ tool_result links.
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AMessage[] } {
  const systemParts: string[] = []
  const out: AMessage[] = []
  let pendingIds: string[] = []
  let resultIdx = 0
  let toolResults: AToolResultBlock[] = []

  const flushToolResults = () => {
    if (toolResults.length) {
      out.push({ role: 'user', content: toolResults })
      toolResults = []
    }
  }

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) systemParts.push(m.content)
      continue
    }
    if (m.role === 'tool') {
      // Collect consecutive tool results into one user message (flushed when a
      // non-tool message follows), pairing ids positionally with the last tool_use.
      const id = pendingIds[resultIdx] ?? `toolu_orphan_${out.length}_${resultIdx}`
      resultIdx++
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: m.content })
      continue
    }
    flushToolResults()
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = m.tool_calls.map((_, i) => `toolu_${out.length}_${i}`)
      const blocks: ABlock[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      m.tool_calls.forEach((c, i) =>
        blocks.push({ type: 'tool_use', id: ids[i], name: c.function.name, input: c.function.arguments ?? {} }),
      )
      out.push({ role: 'assistant', content: blocks })
      pendingIds = ids
      resultIdx = 0
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  flushToolResults()
  return { system: systemParts.join('\n\n'), messages: out }
}

function toAnthropicTools(tools?: Tool[]) {
  return tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))
}

// --- inbound: Anthropic SSE events ------------------------------------------

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

interface AStreamEvent {
  type?: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; partial_json?: string }
  error?: { message?: string }
}
interface AMessageResponse {
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
  error?: { message?: string }
}

async function anthropicChat(config: AnthropicConfig, params: ProviderChatParams): Promise<ChatResponse> {
  const { model, messages, tools, signal, onToken } = params
  const stream = params.stream ?? true
  const { system, messages: aMessages } = toAnthropicMessages(messages)

  let res: Response
  try {
    res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: browserHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        stream,
        ...(system ? { system } : {}),
        messages: aMessages,
        ...(tools ? { tools: toAnthropicTools(tools) } : {}),
      }),
      signal,
    })
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ProviderError(
      'Could not reach Claude. Check your network and that the Anthropic API key in Settings is correct.',
    )
  }

  if (!res.ok) {
    throw new ProviderError(await errorMessage(res), res.status)
  }

  if (!stream || !res.body) {
    const data = (await res.json()) as AMessageResponse
    if (data.error) throw new ProviderError(data.error.message ?? 'Claude error.')
    let content = ''
    const toolCalls: ToolCall[] = []
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) content += block.text
      else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({ function: { name: block.name, arguments: block.input ?? {} } })
      }
    }
    return { message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, streamed: false }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  // Tool-use blocks by SSE index: name from content_block_start, args JSON from
  // the input_json_delta stream.
  const toolBlocks = new Map<number, { name: string; input: string }>()

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    // Anthropic SSE carries `event:` and `data:` lines; the JSON's `type` is
    // authoritative, so we only need the data lines.
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data) return
    let ev: AStreamEvent
    try {
      ev = JSON.parse(data) as AStreamEvent
    } catch {
      return
    }
    switch (ev.type) {
      case 'content_block_start':
        if (ev.content_block?.type === 'tool_use' && typeof ev.index === 'number') {
          toolBlocks.set(ev.index, { name: ev.content_block.name ?? '', input: '' })
        }
        break
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta' && ev.delta.text) {
          content += ev.delta.text
          onToken?.(ev.delta.text)
        } else if (ev.delta?.type === 'input_json_delta' && typeof ev.index === 'number') {
          const b = toolBlocks.get(ev.index)
          if (b && ev.delta.partial_json) b.input += ev.delta.partial_json
        }
        break
      case 'error':
        throw new ProviderError(ev.error?.message ?? 'Claude streamed an error.')
      // message_start / content_block_stop / message_delta / message_stop / ping: ignore
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

  const toolCalls: ToolCall[] = []
  for (const index of [...toolBlocks.keys()].sort((a, b) => a - b)) {
    const b = toolBlocks.get(index)!
    if (b.name) toolCalls.push({ function: { name: b.name, arguments: parseArgs(b.input) } })
  }
  return { message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, streamed: true }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as AMessageResponse
    if (data.error?.message) return `${data.error.message} (HTTP ${res.status})`
  } catch {
    /* non-JSON */
  }
  if (res.status === 401) return 'Claude rejected the API key (HTTP 401). Check the key in Settings.'
  return `Claude returned HTTP ${res.status}.`
}

// Model discovery: GET /v1/models (returns { data: [{ id }] }). Falls back to a
// curated list when unreachable (offline / CORS / no key), so the picker is never empty.
export async function listAnthropicModels(config: AnthropicConfig, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(`${config.baseUrl}/v1/models`, { method: 'GET', headers: browserHeaders(config.apiKey), signal })
    if (!res.ok) return CURATED_MODELS
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    return ids.length ? ids : CURATED_MODELS
  } catch {
    return CURATED_MODELS
  }
}
