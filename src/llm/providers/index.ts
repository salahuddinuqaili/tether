// Public surface of the provider layer (P3-T1). Import providers and the
// normalized LLM types from here — never reach into an adapter file directly.
// Cloud adapters (OpenRouter/OpenAI-compat, Anthropic) join in P3-T3/T4, and a
// createProvider(config) factory keyed on EndpointConfig.kind lands with the
// endpoint config store in P3-T2.

export * from './types'
export { createOllamaProvider, listOllamaModels, type OllamaConfig } from './ollama'
