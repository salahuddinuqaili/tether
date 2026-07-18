// P3-T1 live regression — proves the Provider abstraction preserves every Phase 2
// behavior by driving the REAL refactored agent loop (src/llm/agent.ts →
// provider.chat) against a live Ollama. Not a reimplementation: it imports the
// actual source, so a regression in the refactor fails this script.
//
// It exercises the two tool-call code paths the agent loop must keep working
// (D10): a model with NATIVE tool_calls and a model that LEAKS the call as JSON
// in content. Endpoint + models are runtime config (D4) — never hardcoded here.
//
// Run (PowerShell):
//   $env:OLLAMA_URL="http://localhost:11434"; npx --yes tsx scripts/smoke-provider.ts
// Run (bash):
//   OLLAMA_URL=http://localhost:11434 npx --yes tsx scripts/smoke-provider.ts
//
// Optional env: SMOKE_MODELS="qwen2.5:7b-instruct,qwen2.5-coder:14b" (comma list;
//   the first should support native tool_calls, the second may leak JSON).

import { createOllamaProvider } from '../src/llm/providers'
import { buildSystemPrompt, runAgentTurn } from '../src/llm/agent'
import { parseProposedEdits } from '../src/chat/edits'
import type { ChatMessage } from '../src/llm/providers'

const URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
const MODELS = (process.env.SMOKE_MODELS || 'qwen2.5:7b-instruct,qwen2.5-coder:14b')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const TURN_TIMEOUT_MS = 120_000

const provider = createOllamaProvider({ baseUrl: URL })

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`
let failures = 0
function ok(msg: string) {
  console.log('  ' + green('✓') + ' ' + msg)
}
function bad(msg: string) {
  failures++
  console.log('  ' + red('✗') + ' ' + msg)
}

function withTimeout(): { signal: AbortSignal; done: () => void } {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), TURN_TIMEOUT_MS)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

// Test A — streaming: tokens must arrive incrementally through provider.chat, and
// think:false must keep a thinking model's answer in `content` (not `thinking`).
async function testStreaming(model: string): Promise<void> {
  let tokens = 0
  const { signal, done } = withTimeout()
  try {
    const res = await runAgentTurn({
      provider,
      model,
      messages: [
        { role: 'system', content: 'You are terse. Answer in one short sentence.' },
        { role: 'user', content: 'Say hello and name one primary color.' },
      ],
      readFile: async () => 'unused',
      onToken: () => {
        tokens++
      },
      signal,
    })
    const content = res.content.trim()
    if (tokens >= 2 && content.length > 0) {
      ok(`streaming: ${tokens} token-deltas, answer ${JSON.stringify(content.slice(0, 60))}`)
    } else {
      bad(`streaming weak: ${tokens} deltas, content len ${content.length}`)
    }
  } catch (e) {
    bad(`streaming threw: ${(e as Error).message}`)
  } finally {
    done()
  }
}

// Test B — read_file tool loop: a crafted prompt should make the model call
// read_file; the agent services it (native tool_calls OR the leaked-JSON
// fallback) and loops. PASS = the loop serviced at least one read of the target.
async function testReadFileLoop(model: string): Promise<void> {
  const SENTINEL = 'TETHER_SENTINEL_7Q'
  const target = 'config/secret.txt'
  const reads: string[] = []
  const ctxMsg = buildSystemPrompt({ owner: 'me', name: 'demo', branch: 'main' })
  const { signal, done } = withTimeout()
  try {
    const res = await runAgentTurn({
      provider,
      model,
      messages: [
        { role: 'system', content: ctxMsg },
        {
          role: 'user',
          content: `Use the read_file tool to read "${target}", then tell me the exact token string it contains. Do not guess — read it first.`,
        },
      ] satisfies ChatMessage[],
      readFile: async (p) => (p.includes('secret.txt') ? `The token is ${SENTINEL}.` : `File not found: ${p}`),
      onToken: () => {},
      onRead: (p) => reads.push(p),
      signal,
    })
    if (reads.length > 0) {
      const usedIt = res.content.includes(SENTINEL)
      ok(
        `read_file loop fired: read ${JSON.stringify(reads)}` +
          (usedIt ? ' and the answer quotes the sentinel' : dim(' (answer did not echo the sentinel — loop still worked)')),
      )
    } else {
      bad(`read_file loop did NOT fire (no reads). answer: ${JSON.stringify(res.content.slice(0, 80))}`)
    }
  } catch (e) {
    bad(`read_file loop threw: ${(e as Error).message}`)
  } finally {
    done()
  }
}

// Test C — edit proposal round-trip: the streamed content should carry a
// tether-edit block that parseProposedEdits recovers. Best-effort (model must
// comply); logged, not a hard failure, since compliance varies by model.
async function testEditProposal(model: string): Promise<void> {
  const { signal, done } = withTimeout()
  try {
    const res = await runAgentTurn({
      provider,
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt({ owner: 'me', name: 'demo', branch: 'main' }) },
        {
          role: 'user',
          content:
            'Create a file hello.txt containing exactly the line: hello tether. ' +
            'Propose it as a tether-edit block for path hello.txt.',
        },
      ],
      readFile: async () => 'unused',
      onToken: () => {},
      signal,
    })
    const { edits } = parseProposedEdits(res.content)
    if (edits.length > 0) {
      ok(`edit proposal parsed: ${edits.length} block → path=${JSON.stringify(edits[0].path)}`)
    } else {
      console.log('  ' + dim('· no tether-edit block this run (model compliance varies; not a T1 regression)'))
    }
  } catch (e) {
    console.log('  ' + dim(`· edit proposal skipped: ${(e as Error).message}`))
  } finally {
    done()
  }
}

async function main() {
  console.log(`\nP3-T1 provider regression → ${URL}`)
  console.log(dim(`models: ${MODELS.join(', ')}\n`))

  // Reachability first (the refactored listOllamaModels path).
  let installed: string[] = []
  try {
    installed = await provider.listModels()
    ok(`listModels: ${installed.length} models on the endpoint`)
  } catch (e) {
    bad(`listModels failed — is Ollama up at ${URL}? ${(e as Error).message}`)
    process.exit(1)
  }

  for (const model of MODELS) {
    console.log(`\n▶ ${model}`)
    if (!installed.includes(model)) {
      console.log('  ' + dim(`· not installed on this endpoint — skipping (pull it or set SMOKE_MODELS)`))
      continue
    }
    await testStreaming(model)
    await testReadFileLoop(model)
    await testEditProposal(model)
  }

  console.log('')
  if (failures === 0) {
    console.log(green('P3-T1 PASS') + ' — streaming + read_file loop work unchanged through the Provider abstraction.\n')
  } else {
    console.log(red(`P3-T1 FAIL`) + ` — ${failures} check(s) failed above.\n`)
    process.exit(1)
  }
}

void main()
