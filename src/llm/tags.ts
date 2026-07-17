// Ollama model discovery (GET /api/tags). Shared by Settings' connection test and
// the model picker (P2-T1). The endpoint is runtime config (DECISIONS D4) — it is
// passed in by the caller, never hardcoded here.

export interface OllamaTagsResponse {
  models?: Array<{ name: string }>
}

// Fetch the installed model names from an Ollama endpoint. `url` must already be
// trailing-slash-normalized (as setOllamaUrl stores it). Throws on network / CORS /
// non-2xx so callers can surface the transport failure verbatim.
export async function listModels(url: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${url}/api/tags`, { method: 'GET', signal })
  if (!res.ok) throw new Error(`Endpoint answered HTTP ${res.status}.`)
  const data = (await res.json()) as OllamaTagsResponse
  return (data.models ?? []).map((m) => m.name)
}
