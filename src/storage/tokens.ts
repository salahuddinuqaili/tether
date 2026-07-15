import { idbDelete, idbGet, idbSet } from '../lib/idb'

// Fine-grained GitHub PAT, stored on-device only (DECISIONS 🔒 13 / D4). The token
// is written to IndexedDB and read back into memory to build the Authorization
// header — it is NEVER logged, NEVER committed, and NEVER sent anywhere except
// api.github.com. Do not add console/telemetry statements that touch this value.
const PAT_KEY = 'github_pat'

export async function getToken(): Promise<string | undefined> {
  const value = await idbGet<string>(PAT_KEY)
  return value?.trim() ? value : undefined
}

export async function setToken(token: string): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Token is empty')
  await idbSet(PAT_KEY, trimmed)
}

export async function clearToken(): Promise<void> {
  await idbDelete(PAT_KEY)
}
