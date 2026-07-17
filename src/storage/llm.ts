import { idbDelete, idbGet, idbSet } from '../lib/idb'

// Runtime location of the desktop model endpoint (Phase 2). Per DECISIONS D4/O1
// this is on-device runtime config, never baked into source — no tailnet
// hostname is ever committed. Stored in IndexedDB like the PAT, but it is not a
// secret (a private *.ts.net URL reachable only from your tailnet).
const OLLAMA_URL_KEY = 'ollama_url'
// The chat/agent model name (e.g. "qwen2.5-coder:14b"), chosen at runtime from
// the endpoint's /api/tags list (P2-T1). Like the URL, it is on-device runtime
// config per D4/O1 — never hardcoded, never committed.
const OLLAMA_MODEL_KEY = 'ollama_model'

export async function getOllamaUrl(): Promise<string | undefined> {
  const value = await idbGet<string>(OLLAMA_URL_KEY)
  return value?.trim() ? value : undefined
}

export async function setOllamaUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '') // drop trailing slashes
  if (!trimmed) throw new Error('URL is empty')
  await idbSet(OLLAMA_URL_KEY, trimmed)
}

export async function clearOllamaUrl(): Promise<void> {
  await idbDelete(OLLAMA_URL_KEY)
}

export async function getModel(): Promise<string | undefined> {
  const value = await idbGet<string>(OLLAMA_MODEL_KEY)
  return value?.trim() ? value : undefined
}

export async function setModel(model: string): Promise<void> {
  const trimmed = model.trim()
  if (!trimmed) throw new Error('Model is empty')
  await idbSet(OLLAMA_MODEL_KEY, trimmed)
}

export async function clearModel(): Promise<void> {
  await idbDelete(OLLAMA_MODEL_KEY)
}
