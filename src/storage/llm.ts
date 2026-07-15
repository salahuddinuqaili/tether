import { idbDelete, idbGet, idbSet } from '../lib/idb'

// Runtime location of the desktop model endpoint (Phase 2). Per DECISIONS D4/O1
// this is on-device runtime config, never baked into source — no tailnet
// hostname is ever committed. Stored in IndexedDB like the PAT, but it is not a
// secret (a private *.ts.net URL reachable only from your tailnet).
const OLLAMA_URL_KEY = 'ollama_url'

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
