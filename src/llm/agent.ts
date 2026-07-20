// The agent turn (P2-T4). Wraps the streaming chat client with a read_file tool
// loop so the model can pull related repo files for context before answering or
// proposing an edit. Deterministic edit proposals (the `tether-edit` block) are
// parsed by the app, not by a tool call (P2-T5) — that is far more reliable on a
// local model than trusting a structured "write" tool.

import { type ChatMessage, type Provider, type Tool, type ToolCall } from './providers'

export interface AgentContext {
  owner: string
  name: string
  branch: string
  // The file currently open in the editor, if any — seeded into the system prompt.
  openFilePath?: string
  openFileContent?: string
}

export interface AgentTurnParams {
  // The endpoint to run this turn against (Ollama today; any provider after T3/T4).
  // The agent loop is format-blind — it only calls provider.chat().
  provider: Provider
  model: string
  // System + prior conversation + the new user message, already assembled.
  messages: ChatMessage[]
  // Executes read_file against the repo (Phase 1 getContents under the hood).
  readFile: (path: string) => Promise<string>
  signal?: AbortSignal
  // Streamed content deltas of the CURRENT round (reset between rounds).
  onToken: (delta: string) => void
  // Called before each model round so the caller can clear the streaming buffer.
  onRoundStart?: () => void
  // Status transitions for the UI (thinking vs reading files).
  onStatus?: (status: 'streaming' | 'reading') => void
  // Notified when the agent reads a file, with the path.
  onRead?: (path: string) => void
  // Cap on files read per turn (context-length guard; SPEC risk #3).
  maxReads?: number
}

export interface AgentTurnResult {
  content: string
  reads: string[]
}

// Keep read results from blowing the model's context window (default 8192).
const MAX_FILE_CHARS = 8000

export const READ_FILE_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'read_file',
    description:
      'Read the full current contents of a file in this repository by its path ' +
      '(e.g. "src/index.ts"). Use it to gather context before answering or proposing an edit. ' +
      'Read only the files you actually need.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository-relative file path' },
      },
      required: ['path'],
    },
  },
}

// Build the coding-agent system prompt: who it is, what repo/branch it acts on, the
// currently-open file, how to read more, and the exact edit-proposal format.
export function buildSystemPrompt(ctx: AgentContext | null): string {
  const lines: string[] = [
    'You are tether, a coding agent the user operates from their phone. You act on a single ' +
      'GitHub repository and help read, explain, and change code. Be concise and practical.',
  ]

  if (ctx) {
    lines.push(`\nRepository: ${ctx.owner}/${ctx.name}\nBranch: ${ctx.branch}`)
    lines.push(
      '\nYou can call the read_file tool to read any file in this repository for context. ' +
        'Read only what you need before proposing a change.',
    )
    if (ctx.openFilePath && ctx.openFileContent !== undefined) {
      const { text, truncated } = capText(ctx.openFileContent)
      lines.push(
        `\nThe user currently has this file open — assume changes target it unless they say otherwise:` +
          `\n\nPath: ${ctx.openFilePath}\n\`\`\`\n${text}\n\`\`\`` +
          (truncated ? '\n(File truncated for context; use read_file for the full contents.)' : ''),
      )
    }
  }

  lines.push(
    '\nWhen you propose a concrete change to a file, output the ENTIRE new file contents in a ' +
      'fenced block whose opening fence is exactly:\n' +
      '```tether-edit path=<relative/path>\n' +
      'then the full updated file, then a closing ```. Propose ONE file at a time. Do not use a ' +
      'tether-edit block unless you are actually proposing an edit; for questions, just answer.',
  )

  return lines.join('\n')
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_FILE_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_FILE_CHARS), truncated: true }
}

// Some capable-but-not-tool-wired local models (e.g. qwen2.5-coder) don't emit
// structured `tool_calls`; they print the call as a JSON object in `content`
// instead. Recover it deterministically (same philosophy as the tether-edit block):
// only when the WHOLE message is a JSON object naming read_file with a path — strict
// enough that a normal prose answer never matches.
export function parseLeakedToolCall(content: string): ToolCall | null {
  const trimmed = content.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const body = (fenced ? fenced[1] : trimmed).trim()
  if (!body.startsWith('{') || !body.endsWith('}')) return null
  let obj: unknown
  try {
    obj = JSON.parse(body)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const fn = (o.function ?? {}) as Record<string, unknown>
  const name = o.name ?? o.tool ?? fn.name
  const rawArgs = o.arguments ?? o.parameters ?? fn.arguments
  if (name !== 'read_file' || !rawArgs || typeof rawArgs !== 'object') return null
  const path = (rawArgs as Record<string, unknown>).path
  if (typeof path !== 'string' || !path.trim()) return null
  return { function: { name: 'read_file', arguments: { path } } }
}

// Run one agent turn: stream the model, service any read_file tool calls, and loop
// until the model answers without calling a tool (or the read cap is hit). Only the
// final round's text is the answer; tool rounds are reset via onRoundStart.
export async function runAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const { provider, model, signal, onToken, onRoundStart, onStatus, onRead } = params
  const maxReads = params.maxReads ?? 5
  const messages: ChatMessage[] = [...params.messages]
  const reads: string[] = []

  // Bound total rounds so a misbehaving model can't loop forever.
  const maxRounds = maxReads + 2
  for (let round = 0; round < maxRounds; round++) {
    onStatus?.('streaming')
    onRoundStart?.()
    const res = await provider.chat({
      model,
      messages,
      tools: [READ_FILE_TOOL],
      signal,
      onToken,
      think: false, // keep answers in `content` for thinking models
    })

    // Prefer native tool_calls; recover a leaked JSON call for models that don't
    // structure them (qwen2.5-coder). Either way, no calls → this is the answer.
    let calls = res.message.tool_calls ?? []
    if (calls.length === 0) {
      const leaked = parseLeakedToolCall(res.message.content)
      if (leaked) calls = [leaked]
    }
    if (calls.length === 0) {
      return { content: res.message.content, reads }
    }

    // Tool round: record the assistant's tool request, then answer each call.
    // INVARIANT (adapters depend on this): the single assistant message carrying
    // all `tool_calls` is immediately followed by exactly one `role:'tool'` message
    // per call, in the same order — so tool_calls[i] is answered by the i-th
    // following tool message. Provider adapters reconstruct wire-specific call ids
    // (OpenAI tool_call_id, Anthropic tool_use_id) from this positional pairing
    // (ToolCall carries no id). Do not reorder, batch, or interleave these pushes.
    onStatus?.('reading')
    messages.push({ role: 'assistant', content: res.message.content, tool_calls: calls })
    for (const call of calls) {
      if (call.function.name !== 'read_file') {
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: `Unknown tool "${call.function.name}". Only read_file is available.`,
        })
        continue
      }
      const path = String((call.function.arguments as { path?: unknown })?.path ?? '').trim()
      let result: string
      if (reads.length >= maxReads) {
        result = 'Read limit reached for this turn — answer with the context you already have.'
      } else if (!path) {
        result = 'read_file requires a non-empty "path".'
      } else {
        onRead?.(path)
        const { text, truncated } = capText(await params.readFile(path))
        result = truncated ? `${text}\n…(truncated)` : text
        reads.push(path)
      }
      messages.push({ role: 'tool', tool_name: 'read_file', content: result })
    }
  }

  // Exhausted rounds without a plain answer — make one final, tool-free pass so the
  // user always gets a response.
  onStatus?.('streaming')
  onRoundStart?.()
  const final = await provider.chat({ model, messages, signal, onToken, think: false })
  return { content: final.message.content, reads }
}
