// P3-T7 sessions regression — proves the two mechanisms multi-chat rides on:
//  1. Per-session streaming ISOLATION: a token in one session notifies only that
//     session's subscriber, never another's (the SPEC §3 guarantee that lets two
//     sessions stream at once while only the active bubble re-renders).
//  2. Reload-safe persistence: saveSessions sanitizes (drops in-flight placeholders,
//     resets non-error status, clears transient attachments) and round-trips.
//
// Run:  npx --yes tsx scripts/smoke-sessions.ts

import 'fake-indexeddb/auto'
import {
  appendStreaming,
  disposeStreaming,
  getStreamingText,
  resetStreaming,
  subscribeStreaming,
} from '../src/chat/streaming'
import { createSession, deriveTitle, loadSessions, saveSessions } from '../src/chat/sessions'
import { runAgentTurn } from '../src/llm/agent'
import type { Provider } from '../src/llm/providers'
import type { Session } from '../src/chat/types'

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

function streamingIsolation() {
  console.log('\n▶ per-session streaming isolation (SPEC §3)')
  let aNotifies = 0
  let bNotifies = 0
  const unsubA = subscribeStreaming('A', () => aNotifies++)
  const unsubB = subscribeStreaming('B', () => bNotifies++)

  appendStreaming('A', 'Hel')
  appendStreaming('B', 'foo')
  appendStreaming('A', 'lo')

  eq(getStreamingText('A'), 'Hello', 'channel A accumulates its own text')
  eq(getStreamingText('B'), 'foo', 'channel B accumulates independently')
  eq(aNotifies, 2, "A's subscriber fired only for A's tokens (2), not B's")
  eq(bNotifies, 1, "B's subscriber fired only for B's token (1)")

  resetStreaming('A')
  eq(getStreamingText('A'), '', 'resetStreaming(A) clears only A')
  eq(getStreamingText('B'), 'foo', 'B untouched by A reset')

  unsubA()
  appendStreaming('A', 'x')
  eq(aNotifies, 2, 'after unsubscribe, A no longer notifies')

  unsubB()
  disposeStreaming('A')
  disposeStreaming('B')
  eq(getStreamingText('A'), '', 'disposed channel reads empty')
}

async function persistence() {
  console.log('\n▶ reload-safe persistence')
  const sessions: Session[] = [
    {
      id: 's1',
      title: 'Chat 1',
      endpointId: 'e1',
      model: 'qwen2.5:7b-instruct',
      status: 'streaming',
      attachments: [{ path: 'a.ts', content: 'x' }],
      messages: [
        { id: 'u1', role: 'user', content: 'hi' },
        { id: 'a1', role: 'assistant', content: 'partial…', streaming: true },
      ],
    },
    {
      id: 's2',
      title: 'Chat 2',
      status: 'error',
      attachments: [],
      messages: [
        { id: 'u2', role: 'user', content: 'q' },
        { id: 'a2', role: 'assistant', content: 'failed', error: true },
      ],
    },
  ]
  await saveSessions(sessions, 's2')
  const { sessions: loaded, activeId } = await loadSessions()

  eq(activeId, 's2', 'active session id round-trips')
  eq(loaded.length, 2, 'both sessions persisted')
  eq(loaded[0].status, 'idle', 's1 streaming status reset to idle on reload')
  eq(loaded[0].messages.map((m) => m.id), ['u1'], 's1 in-flight streaming placeholder dropped')
  eq(loaded[0].attachments, [], 's1 transient attachments cleared')
  eq(loaded[0].endpointId, 'e1', 's1 endpoint binding preserved')
  eq(loaded[1].status, 'error', 's2 error status preserved')
  eq(
    loaded[1].messages.map((m) => m.id),
    ['u2', 'a2'],
    's2 finalized messages (incl. the error bubble) preserved',
  )
}

function helpers() {
  console.log('\n▶ session helpers')
  eq(deriveTitle('  Fix the login   bug please '), 'Fix the login bug please', 'deriveTitle trims + collapses whitespace')
  eq(deriveTitle('x'.repeat(60)).endsWith('…'), true, 'deriveTitle truncates long titles')
  eq(deriveTitle('').length > 0, true, 'deriveTitle falls back to a default')
  const s = createSession({ endpointId: 'e9', model: 'm9' })
  eq([s.endpointId, s.model, s.status, s.messages.length], ['e9', 'm9', 'idle', 0], 'createSession seeds binding + empty idle chat')
}

// A provider that streams the given tokens with a delay, so two turns awaited in
// parallel actually interleave (proving concurrency, not sequential fallthrough).
function mockStreamProvider(tokens: string[], delayMs: number): Provider {
  return {
    kind: 'openai',
    async chat({ onToken }) {
      for (const t of tokens) {
        await new Promise((r) => setTimeout(r, delayMs))
        onToken?.(t)
      }
      return { message: { role: 'assistant', content: tokens.join('') }, streamed: true }
    },
    async listModels() {
      return []
    },
  }
}

async function concurrency() {
  console.log('\n▶ concurrent turns via the real agent loop')
  const order: string[] = []
  const runA = runAgentTurn({
    provider: mockStreamProvider(['a1', 'a2', 'a3'], 8),
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    readFile: async () => '',
    onToken: (d) => {
      appendStreaming('SA', d)
      order.push('A')
    },
  })
  const runB = runAgentTurn({
    provider: mockStreamProvider(['b1', 'b2', 'b3'], 8),
    model: 'm',
    messages: [{ role: 'user', content: 'y' }],
    readFile: async () => '',
    onToken: (d) => {
      appendStreaming('SB', d)
      order.push('B')
    },
  })
  const [rA, rB] = await Promise.all([runA, runB])

  eq(getStreamingText('SA'), 'a1a2a3', 'session A channel holds only A tokens under concurrency')
  eq(getStreamingText('SB'), 'b1b2b3', 'session B channel holds only B tokens under concurrency')
  eq([rA.content, rB.content], ['a1a2a3', 'b1b2b3'], 'both turns resolved with their own answer')
  const seq = order.join('')
  eq(/A.*B.*A/.test(seq) || /B.*A.*B/.test(seq), true, `tokens interleaved (${seq}) → the two turns ran concurrently`)
  disposeStreaming('SA')
  disposeStreaming('SB')
}

async function main() {
  console.log('\nP3-T7 sessions regression')
  streamingIsolation()
  await persistence()
  helpers()
  await concurrency()
  console.log('')
  if (failures === 0)
    console.log('\x1b[32mP3-T7 PASS\x1b[0m — per-session streaming is isolated; sessions persist reload-safely.\n')
  else {
    console.log(`\x1b[31mP3-T7 FAIL\x1b[0m — ${failures} check(s) failed.\n`)
    process.exit(1)
  }
}

void main()
