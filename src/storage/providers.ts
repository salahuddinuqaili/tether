import { idbGet, idbSet } from '../lib/idb'
import { getModel as getLegacyModel, getOllamaUrl as getLegacyOllamaUrl } from './llm'
import type { EndpointConfig, ProviderKind } from '../llm/providers'

// On-device store for configured LLM endpoints (P3-T2, DECISIONS D4/D8/D13). The
// endpoint list + the active binding live in IndexedDB like the PAT and the old
// ollama_url — never committed, never baked into source. apiKeys inside an
// EndpointConfig are SPENDABLE credentials: this module never logs or displays
// them; do not add telemetry that touches a config's apiKey.
const ENDPOINTS_KEY = 'provider_endpoints'
const ACTIVE_ENDPOINT_KEY = 'active_endpoint_id'
// The model bound to the active endpoint for the (single, this phase) chat. T7's
// sessions layer moves this per-session; for now it is the one chat's binding.
const ACTIVE_MODEL_KEY = 'active_model'

export function newEndpointId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ep_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

// Strip trailing slashes so adapters can append their path (/api/chat,
// /chat/completions, /v1/messages) without doubling up.
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// A blank config for a new endpoint of the given kind, with sensible cloud
// defaults. baseUrl is prefilled for cloud (fixed API host) and empty for Ollama
// (the user's private tailnet URL). Caller assigns the id via newEndpointId().
export function defaultEndpoint(kind: ProviderKind): Omit<EndpointConfig, 'id'> {
  switch (kind) {
    case 'ollama':
      return { kind, label: 'Desktop (Ollama)', baseUrl: '' }
    case 'openai':
      return { kind, label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }
    case 'anthropic':
      return { kind, label: 'Claude', baseUrl: 'https://api.anthropic.com' }
  }
}

export async function getEndpoints(): Promise<EndpointConfig[]> {
  return (await idbGet<EndpointConfig[]>(ENDPOINTS_KEY)) ?? []
}

// Insert or replace an endpoint by id, normalizing its baseUrl.
export async function upsertEndpoint(cfg: EndpointConfig): Promise<void> {
  const clean: EndpointConfig = { ...cfg, baseUrl: normalizeBaseUrl(cfg.baseUrl) }
  const endpoints = await getEndpoints()
  const idx = endpoints.findIndex((e) => e.id === clean.id)
  if (idx >= 0) endpoints[idx] = clean
  else endpoints.push(clean)
  await idbSet(ENDPOINTS_KEY, endpoints)
}

// Remove an endpoint. If it was the active one, fail over to the first remaining
// endpoint (and its remembered model) so the chat is never left pointing at nothing.
export async function deleteEndpoint(id: string): Promise<void> {
  const endpoints = (await getEndpoints()).filter((e) => e.id !== id)
  await idbSet(ENDPOINTS_KEY, endpoints)
  if ((await getActiveEndpointId()) === id) {
    const next = endpoints[0]
    await setActiveEndpointId(next?.id ?? '')
    await setActiveModel(next?.model ?? '')
  }
}

export async function getActiveEndpointId(): Promise<string | undefined> {
  const v = await idbGet<string>(ACTIVE_ENDPOINT_KEY)
  return v?.trim() ? v : undefined
}

export async function setActiveEndpointId(id: string): Promise<void> {
  await idbSet(ACTIVE_ENDPOINT_KEY, id)
}

export async function getActiveModel(): Promise<string | undefined> {
  const v = await idbGet<string>(ACTIVE_MODEL_KEY)
  return v?.trim() ? v : undefined
}

export async function setActiveModel(model: string): Promise<void> {
  await idbSet(ACTIVE_MODEL_KEY, model)
}

// Persist the model choice both as the active-chat binding and as the endpoint's
// remembered last model, so switching endpoints and back restores it.
export async function setActiveModelForEndpoint(endpointId: string, model: string): Promise<void> {
  await setActiveModel(model)
  const endpoints = await getEndpoints()
  const idx = endpoints.findIndex((e) => e.id === endpointId)
  if (idx >= 0 && endpoints[idx].model !== model) {
    endpoints[idx] = { ...endpoints[idx], model }
    await idbSet(ENDPOINTS_KEY, endpoints)
  }
}

// Resolve the active {endpoint, model} the chat should run against. Falls back to
// the first endpoint when the stored active id is stale, and to the endpoint's
// remembered model when no active model is set. Null when nothing is configured.
export async function getActiveBinding(): Promise<{ endpoint: EndpointConfig; model?: string } | null> {
  const [endpoints, activeId, activeModel] = await Promise.all([
    getEndpoints(),
    getActiveEndpointId(),
    getActiveModel(),
  ])
  if (endpoints.length === 0) return null
  const endpoint = endpoints.find((e) => e.id === activeId) ?? endpoints[0]
  return { endpoint, model: activeModel ?? endpoint.model }
}

// One-time migration of the Phase 2 single-endpoint keys (ollama_url/ollama_model)
// into an EndpointConfig, so an existing install keeps working with no re-setup.
// No-op once any endpoint exists or when there's nothing to migrate. The legacy
// keys are left in place (readable) rather than deleted.
export async function migrateLegacyOllama(): Promise<void> {
  if ((await getEndpoints()).length > 0) return
  const [url, model] = await Promise.all([getLegacyOllamaUrl(), getLegacyModel()])
  if (!url) return
  const ep: EndpointConfig = {
    id: newEndpointId(),
    kind: 'ollama',
    label: 'Desktop (Ollama)',
    baseUrl: normalizeBaseUrl(url),
    ...(model ? { model } : {}),
  }
  await idbSet(ENDPOINTS_KEY, [ep])
  await setActiveEndpointId(ep.id)
  if (model) await setActiveModel(model)
}
