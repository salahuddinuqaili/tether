// P3-T2 store regression — proves the endpoint config store persists across a
// reload and that migration + active-failover behave. Runs the REAL
// src/storage/providers.ts against a spec-compliant in-memory IndexedDB
// (fake-indexeddb), so a bug in the store fails this script. Not a browser, but
// the exact idb.ts code path a browser runs.
//
// Run:  npx --yes tsx scripts/smoke-endpoints.ts

import 'fake-indexeddb/auto'
import {
  deleteEndpoint,
  defaultEndpoint,
  getActiveBinding,
  getActiveEndpointId,
  getEndpoints,
  migrateLegacyOllama,
  newEndpointId,
  setActiveEndpointId,
  setActiveModelForEndpoint,
  upsertEndpoint,
} from '../src/storage/providers'
import { setOllamaUrl, setModel } from '../src/storage/llm'
import { idbGet } from '../src/lib/idb'
import { createProvider, type EndpointConfig } from '../src/llm/providers'

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

// A "reload" is a fresh read from the same underlying IndexedDB — the store keeps
// no module state, so re-reading is exactly what a page reload does.
async function main() {
  console.log('\nP3-T2 endpoint store regression (fake-indexeddb)\n')

  // 1. Migration seeds a Phase 2 install's ollama_url/ollama_model as one endpoint.
  await setOllamaUrl('https://sapne.example.ts.net/')
  await setModel('qwen2.5-coder:14b')
  await migrateLegacyOllama()
  let eps = await getEndpoints()
  eq(eps.length, 1, 'after migration: endpoint count')
  eq(eps[0]?.kind, 'ollama', 'migrated kind')
  eq(eps[0]?.baseUrl, 'https://sapne.example.ts.net', 'migrated baseUrl (trailing slash stripped)')
  eq(eps[0]?.model, 'qwen2.5-coder:14b', 'migrated model')
  const binding0 = await getActiveBinding()
  eq(binding0?.endpoint.kind, 'ollama', 'active binding after migration is the ollama endpoint')
  eq(binding0?.model, 'qwen2.5-coder:14b', 'active model after migration')

  // 2. Migration is idempotent (no duplicate on a second run).
  await migrateLegacyOllama()
  eq((await getEndpoints()).length, 1, 'migration idempotent (still 1)')

  // 3. Add a second endpoint (a cloud one with a key) and persist it.
  const or: EndpointConfig = { id: newEndpointId(), ...defaultEndpoint('openai'), apiKey: 'sk-or-secret', model: 'openai/gpt-4o-mini' }
  await upsertEndpoint(or)
  eq((await getEndpoints()).length, 2, 'two endpoints configured')

  // 4. RELOAD: re-read from storage; both endpoints + the key survive.
  eps = await getEndpoints()
  eq(eps.length, 2, 'after reload: endpoint count (persist across reload)')
  const reloadedOr = eps.find((e) => e.id === or.id)
  eq(reloadedOr?.apiKey, 'sk-or-secret', 'cloud apiKey persisted across reload')
  eq(reloadedOr?.baseUrl, 'https://openrouter.ai/api/v1', 'cloud default baseUrl persisted')

  // 5. Edit-in-place: upsert same id updates, does not duplicate.
  await upsertEndpoint({ ...reloadedOr!, label: 'OpenRouter (main)' })
  eps = await getEndpoints()
  eq(eps.length, 2, 'upsert same id does not duplicate')
  eq(eps.find((e) => e.id === or.id)?.label, 'OpenRouter (main)', 'label updated in place')

  // 6. Active failover: make the cloud endpoint active, then delete it → active
  // falls back to the remaining endpoint (never stranded).
  await setActiveEndpointId(or.id)
  eq(await getActiveEndpointId(), or.id, 'cloud endpoint is active')
  await deleteEndpoint(or.id)
  eps = await getEndpoints()
  eq(eps.length, 1, 'after delete: one endpoint left')
  const binding1 = await getActiveBinding()
  eq(binding1?.endpoint.id, eps[0].id, 'active failed over to the surviving endpoint')

  // 7. Legacy keys remain readable (migration is non-destructive). setOllamaUrl
  // already normalized the trailing slash on save, so that's what's stored.
  eq(await idbGet('ollama_url'), 'https://sapne.example.ts.net', 'legacy ollama_url still readable')

  // 8. (P3-T5 contract) The chat picker writes the active {endpoint, model}; what it
  // writes is exactly what getActiveBinding + createProvider return — i.e. what
  // ChatProvider reads at send, so the NEXT message uses the newly-picked provider.
  const ollamaId = (await getEndpoints())[0].id
  const cloud: EndpointConfig = { id: newEndpointId(), ...defaultEndpoint('openai'), apiKey: 'sk-or-2', model: 'openai/gpt-4o-mini' }
  await upsertEndpoint(cloud)
  await setActiveEndpointId(cloud.id)
  await setActiveModelForEndpoint(cloud.id, 'openai/gpt-4o-mini')
  let b = await getActiveBinding()
  eq([b?.endpoint.kind, b?.model], ['openai', 'openai/gpt-4o-mini'], 'switch to cloud → binding is the cloud endpoint + model')
  eq(createProvider(b!.endpoint).kind, 'openai', 'createProvider(binding) yields the OpenAI provider')
  // Switch back to local with a different model → binding follows (local↔cloud).
  await setActiveEndpointId(ollamaId)
  await setActiveModelForEndpoint(ollamaId, 'qwen2.5:7b-instruct')
  b = await getActiveBinding()
  eq([b?.endpoint.kind, b?.model], ['ollama', 'qwen2.5:7b-instruct'], 'switch back to local → binding is the ollama endpoint + new model')
  eq(createProvider(b!.endpoint).kind, 'ollama', 'createProvider(binding) yields the Ollama provider')

  console.log('')
  if (failures === 0) console.log('\x1b[32mP3-T2 PASS\x1b[0m — endpoints migrate, persist across reload, and never strand the chat.\n')
  else {
    console.log(`\x1b[31mP3-T2 FAIL\x1b[0m — ${failures} check(s) failed.\n`)
    process.exit(1)
  }
}

void main()
