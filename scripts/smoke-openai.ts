// P3-T3 OpenAI-compat adapter regression. Two layers:
//  1. MOCK tests (always run, no key, no network): drive the REAL adapter against
//     canned OpenAI SSE frames to prove content assembly, tool-call delta assembly,
//     message translation + id pairing, and error handling — deterministically.
//  2. LIVE test (only if OPENROUTER_API_KEY is set): drive the REAL refactored agent
//     loop through the OpenAI provider against live OpenRouter — proves end-to-end
//     streaming (+ read_file if the model supports tools). CORS is already proven by
//     the browser spike; this confirms the adapter parses the real wire.
//
// Run mock only (self-check):   npx --yes tsx scripts/smoke-openai.ts
// Run live too (your key):      OPENROUTER_API_KEY=sk-or-... [OPENROUTER_MODEL=openai/gpt-4o-mini] npx --yes tsx scripts/smoke-openai.ts

import { createOpenAIProvider, type ChatMessage } from '../src/llm/providers'
import { toOpenAIMessages } from '../src/llm/providers/openai'
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

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
// Build a streamed Response from raw byte chunks (so we can split a frame across reads).
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

const provider = createOpenAIProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test' })

async function mockTests() {
  console.log('\n▶ mock SSE parsing (no key / no network)')

  // 1. Content streaming, including a frame split across two byte chunks.
  {
    stub(
      streamResponse([
        frame({ choices: [{ delta: { role: 'assistant' } }] }),
        frame({ choices: [{ delta: { content: 'Hel' } }] }),
        // split this frame mid-JSON across reads:
        'data: {"choices":[{"delta":{"content":"lo Wor',
        'ld"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    let tokens = 0
    const res = await provider.chat({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      onToken: () => tokens++,
    })
    eq(res.message.content, 'Hello World', 'content assembled across split frames')
    eq(tokens, 2, 'onToken fired per content delta')
    eq(res.message.tool_calls, undefined, 'no tool_calls on a plain answer')
  }

  // 2. Tool-call assembled from deltas (name + arguments streamed in pieces).
  {
    stub(
      streamResponse([
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"src/app.ts"}' } }] } }] }),
        frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]),
    )
    const res = await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'read it' }] })
    eq(res.message.tool_calls?.length, 1, 'one tool_call assembled from deltas')
    eq(res.message.tool_calls?.[0].function.name, 'read_file', 'tool name captured')
    eq(res.message.tool_calls?.[0].function.arguments, { path: 'src/app.ts' }, 'arguments JSON assembled + parsed')
  }

  // 3. Message translation: assistant tool_call id must match the following tool result.
  {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'read file' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
      { role: 'tool', tool_name: 'read_file', content: 'contents of a.ts' },
      { role: 'assistant', content: 'done' },
    ]
    const oai = toOpenAIMessages(msgs) as Array<Record<string, unknown>>
    const asstId = (oai[2].tool_calls as Array<{ id: string }>)[0].id
    const toolId = oai[3].tool_call_id as string
    eq(asstId === toolId && !!asstId, true, `assistant tool_call id === following tool_call_id (${asstId})`)
    eq((oai[2].tool_calls as Array<{ function: { arguments: string } }>)[0].function.arguments, '{"path":"a.ts"}', 'outbound args serialized to JSON string')
    eq(oai[2].content, null, 'empty assistant content becomes null alongside tool_calls')
  }

  // 4. A streamed error frame surfaces as a thrown ProviderError.
  {
    stub(streamResponse([frame({ error: { message: 'rate limited' } }), 'data: [DONE]\n\n']))
    try {
      await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      bad('streamed error should have thrown')
    } catch (e) {
      eq((e as Error).message, 'rate limited', 'streamed error → ProviderError(message)')
    }
  }

  // 5. Non-2xx surfaces the provider error message + status.
  {
    stub(new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }))
    try {
      await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      bad('401 should have thrown')
    } catch (e) {
      eq((e as Error).message, 'invalid key (HTTP 401)', '401 → ProviderError with message + status')
    }
  }

  // 6. listModels maps { data: [{id}] } → ids.
  {
    stub(new Response(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }, { id: 'anthropic/claude-3.5-sonnet' }] }), { status: 200 }))
    const models = await provider.listModels()
    eq(models, ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'], 'listModels maps /models ids')
  }

  // 7. Two tool calls in ONE turn assemble independently by index.
  {
    stub(
      streamResponse([
        frame({ choices: [{ delta: { tool_calls: [
          { index: 0, id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
          { index: 1, id: 'b', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
        ] } }] }),
        'data: [DONE]\n\n',
      ]),
    )
    const res = await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'read both' }] })
    eq(res.message.tool_calls?.length, 2, 'two tool calls in one turn')
    eq(res.message.tool_calls?.map((c) => (c.function.arguments as { path: string }).path), ['a.ts', 'b.ts'], 'both tool-call args parsed by index')
  }

  // 8. Multi-round translation: each round's ids are distinct and pair correctly.
  {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
      { role: 'tool', tool_name: 'read_file', content: 'A' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'b.ts' } } }] },
      { role: 'tool', tool_name: 'read_file', content: 'B' },
      { role: 'assistant', content: 'answer' },
    ]
    const oai = toOpenAIMessages(msgs) as Array<Record<string, unknown>>
    const r1a = (oai[1].tool_calls as Array<{ id: string }>)[0].id
    const r1t = oai[2].tool_call_id as string
    const r2a = (oai[3].tool_calls as Array<{ id: string }>)[0].id
    const r2t = oai[4].tool_call_id as string
    eq(r1a === r1t && r2a === r2t && r1a !== r2a, true, `round-1 and round-2 ids pair and differ (${r1a}, ${r2a})`)
  }
}

async function liveTest(key: string) {
  globalThis.fetch = realFetch // real network for the live leg
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
  console.log(`\n▶ live OpenRouter (${model})`)
  const live = createOpenAIProvider({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: key })
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
      readFile: async (p) => (p.includes('secret.txt') ? 'The token is OPENROUTER_OK_88.' : `not found: ${p}`),
      onToken: () => tokens++,
      onRead: (p) => reads.push(p),
      signal: controller.signal,
    })
    if (tokens >= 1 && res.content.trim()) ok(`streamed ${tokens} deltas; answer ${JSON.stringify(res.content.slice(0, 70))}`)
    else bad(`weak stream: ${tokens} deltas, content len ${res.content.length}`)
    if (reads.length) ok(`read_file loop fired via OpenAI tool_calls: ${JSON.stringify(reads)}${res.content.includes('OPENROUTER_OK_88') ? ' (sentinel quoted)' : ''}`)
    else console.log('  \x1b[90m· model did not call read_file this run (tool support varies) — streaming still proven\x1b[0m')
  } catch (e) {
    bad(`live turn threw: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log('\nP3-T3 OpenAI-compat adapter regression')
  await mockTests()
  const key = process.env.OPENROUTER_API_KEY
  if (key) await liveTest(key)
  else console.log('\n  \x1b[90m· no OPENROUTER_API_KEY set — skipping the live OpenRouter leg (mock parsing already proven above)\x1b[0m')

  console.log('')
  if (failures === 0) console.log('\x1b[32mP3-T3 PASS\x1b[0m — OpenAI-compat adapter parses SSE, assembles tool calls, translates messages.\n')
  else {
    console.log(`\x1b[31mP3-T3 FAIL\x1b[0m — ${failures} check(s) failed.\n`)
    process.exit(1)
  }
}

void main()
