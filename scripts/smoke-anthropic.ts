// P3-T4 Anthropic adapter regression. Same two layers as the OpenAI smoke:
//  1. MOCK (always, no key): drive the REAL adapter against canned Anthropic SSE
//     events + assert the system-extraction / tool_result-collapsing translation.
//  2. LIVE (only if ANTHROPIC_API_KEY set): real /v1/messages via the agent loop.
//     The user has no key yet, so this leg normally skips — S-P3-2 already proved
//     the CORS gate; this confirms the adapter parses the real wire when a key exists.
//
// Run mock only:  npx --yes tsx scripts/smoke-anthropic.ts
// Run live too:   ANTHROPIC_API_KEY=sk-ant-... [ANTHROPIC_MODEL=claude-3-5-haiku-20241022] npx --yes tsx scripts/smoke-anthropic.ts

import { createAnthropicProvider, type ChatMessage } from '../src/llm/providers'
import { toAnthropicMessages } from '../src/llm/providers/anthropic'
import { buildSystemPrompt, runAgentTurn } from '../src/llm/agent'

const realFetch = globalThis.fetch
let failures = 0
const ok = (m: string) => console.log('  \x1b[32m✓\x1b[0m ' + m)
const bad = (m: string) => {
  failures++
  console.log('  \x1b[31m✗\x1b[0m ' + m)
}
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(`${label} → ${JSON.stringify(actual)}`)
  else bad(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

// Realistic Anthropic SSE: an `event:` line + a `data:` line (the adapter uses the
// JSON `type`, so event: is ignored — included to prove that).
const aframe = (obj: { type: string } & Record<string, unknown>) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`
function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}
function stub(res: Response | (() => Response)) {
  globalThis.fetch = (async () => (typeof res === 'function' ? res() : res)) as typeof fetch
}

const provider = createAnthropicProvider({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' })

async function mockTests() {
  console.log('\n▶ mock SSE parsing + translation (no key / no network)')

  // 1. Text streaming (text_delta events), incl. a frame split across reads.
  {
    stub(
      streamResponse([
        aframe({ type: 'message_start', message: {} }),
        aframe({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
        aframe({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo Wor',
        'ld"}}\n\n',
        aframe({ type: 'content_block_stop', index: 0 }),
        aframe({ type: 'message_stop' }),
      ]),
    )
    let tokens = 0
    const res = await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }], onToken: () => tokens++ })
    eq(res.message.content, 'Hello World', 'text_delta content assembled across split frames')
    eq(tokens, 2, 'onToken fired per text_delta')
    eq(res.message.tool_calls, undefined, 'no tool_calls on a plain answer')
  }

  // 2. Mixed text + tool_use (text block idx 0, tool_use block idx 1; input streamed).
  {
    stub(
      streamResponse([
        aframe({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
        aframe({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me read that.' } }),
        aframe({ type: 'content_block_stop', index: 0 }),
        aframe({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' } }),
        aframe({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
        aframe({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"src/x.ts"}' } }),
        aframe({ type: 'content_block_stop', index: 1 }),
      ]),
    )
    const res = await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'read it' }] })
    eq(res.message.content, 'Let me read that.', 'text captured alongside tool_use')
    eq(res.message.tool_calls?.length, 1, 'one tool_use assembled')
    eq(res.message.tool_calls?.[0].function.name, 'read_file', 'tool name from content_block_start')
    eq(res.message.tool_calls?.[0].function.arguments, { path: 'src/x.ts' }, 'input_json_delta assembled + parsed')
  }

  // 3. Translation: system → top-level; tool result → user message; ids paired.
  {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'You are tether.' },
      { role: 'user', content: 'read a.ts' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
      { role: 'tool', tool_name: 'read_file', content: 'contents A' },
      { role: 'assistant', content: 'The file says A.' },
    ]
    const { system, messages } = toAnthropicMessages(msgs)
    eq(system, 'You are tether.', 'system extracted to top-level field')
    eq(messages.length, 4, 'no system role left in messages')
    const asst = messages[1] as { role: string; content: Array<{ type: string; id?: string }> }
    const userTR = messages[2] as { role: string; content: Array<{ type: string; tool_use_id?: string }> }
    eq(asst.content[0].type, 'tool_use', 'assistant tool_call → tool_use block')
    eq(userTR.role, 'user', 'tool result becomes a user message')
    eq(userTR.content[0].type, 'tool_result', 'tool result → tool_result block')
    eq(asst.content[0].id === userTR.content[0].tool_use_id && !!asst.content[0].id, true, `tool_use id === tool_result tool_use_id (${asst.content[0].id})`)
  }

  // 4. Two tool results collapse into a SINGLE user message, ids paired in order.
  {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'read both' },
      { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'read_file', arguments: { path: 'a.ts' } } },
        { function: { name: 'read_file', arguments: { path: 'b.ts' } } },
      ] },
      { role: 'tool', tool_name: 'read_file', content: 'A' },
      { role: 'tool', tool_name: 'read_file', content: 'B' },
      { role: 'assistant', content: 'done' },
    ]
    const { messages } = toAnthropicMessages(msgs)
    const asst = messages[1] as { content: Array<{ type: string; id: string }> }
    const userTR = messages[2] as { role: string; content: Array<{ type: string; tool_use_id: string; content: string }> }
    eq(userTR.role === 'user' && userTR.content.length, 2, 'two tool results collapsed into one user message')
    eq(
      [userTR.content[0].tool_use_id, userTR.content[1].tool_use_id],
      [asst.content[0].id, asst.content[1].id],
      'both tool_result ids pair with the two tool_use ids in order',
    )
  }

  // 5. A streamed error event throws.
  {
    stub(streamResponse([aframe({ type: 'error', error: { message: 'overloaded' } })]))
    try {
      await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      bad('streamed error should have thrown')
    } catch (e) {
      eq((e as Error).message, 'overloaded', 'streamed error → ProviderError(message)')
    }
  }

  // 6. Non-2xx surfaces the message + status.
  {
    stub(new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }))
    try {
      await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      bad('401 should have thrown')
    } catch (e) {
      eq((e as Error).message, 'invalid x-api-key (HTTP 401)', '401 → ProviderError with message + status')
    }
  }

  // 7. listModels: /v1/models ids, and curated fallback when unreachable.
  {
    stub(new Response(JSON.stringify({ data: [{ id: 'claude-3-5-sonnet-20241022' }] }), { status: 200 }))
    eq(await provider.listModels(), ['claude-3-5-sonnet-20241022'], 'listModels maps /v1/models ids')
    stub(new Response('nope', { status: 500 }))
    const fallback = await provider.listModels()
    eq(fallback.length >= 3 && fallback.includes('claude-3-5-haiku-20241022'), true, 'listModels falls back to a curated list when /v1/models fails')
  }
}

async function liveTest(key: string) {
  globalThis.fetch = realFetch
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022'
  console.log(`\n▶ live Anthropic (${model})`)
  const live = createAnthropicProvider({ baseUrl: 'https://api.anthropic.com', apiKey: key })
  const reads: string[] = []
  let tokens = 0
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await runAgentTurn({
      provider: live,
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt({ owner: 'me', name: 'demo', branch: 'main' }) },
        { role: 'user', content: 'Use read_file to read "config/secret.txt", then quote the exact token it contains.' },
      ],
      readFile: async (p) => (p.includes('secret.txt') ? 'The token is ANTHROPIC_OK_91.' : `not found: ${p}`),
      onToken: () => tokens++,
      onRead: (p) => reads.push(p),
      signal: controller.signal,
    })
    if (tokens >= 1 && res.content.trim()) ok(`streamed ${tokens} deltas; answer ${JSON.stringify(res.content.slice(0, 70))}`)
    else bad(`weak stream: ${tokens} deltas, content len ${res.content.length}`)
    if (reads.length) ok(`read_file loop fired via tool_use: ${JSON.stringify(reads)}${res.content.includes('ANTHROPIC_OK_91') ? ' (sentinel quoted)' : ''}`)
    else console.log('  \x1b[90m· model did not call read_file this run — streaming still proven\x1b[0m')
  } catch (e) {
    bad(`live turn threw: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log('\nP3-T4 Anthropic adapter regression')
  await mockTests()
  const key = process.env.ANTHROPIC_API_KEY
  if (key) await liveTest(key)
  else console.log('\n  \x1b[90m· no ANTHROPIC_API_KEY set — skipping the live leg (CORS gate proven by the spike; mock parsing proven above)\x1b[0m')

  console.log('')
  if (failures === 0) console.log('\x1b[32mP3-T4 PASS\x1b[0m — Anthropic adapter parses SSE events, assembles tool_use, translates messages.\n')
  else {
    console.log(`\x1b[31mP3-T4 FAIL\x1b[0m — ${failures} check(s) failed.\n`)
    process.exit(1)
  }
}

void main()
