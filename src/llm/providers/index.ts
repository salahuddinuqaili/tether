// Public surface of the provider layer. Import providers and the normalized LLM
// types from here — never reach into an adapter file directly.

import { createOllamaProvider } from './ollama'
import { createOpenAIProvider } from './openai'
import { ProviderError, type EndpointConfig, type Provider } from './types'

export * from './types'
export { createOllamaProvider, listOllamaModels, type OllamaConfig } from './ollama'
export { createOpenAIProvider, listOpenAIModels, type OpenAIConfig } from './openai'

// Turn a persisted EndpointConfig into a live Provider (P3-T2). The single seam
// where kind → adapter; every consumer (agent loop, chat picker, sessions) goes
// through here. OpenAI-compat and Anthropic adapters are wired in P3-T3/T4.
export function createProvider(config: EndpointConfig): Provider {
  switch (config.kind) {
    case 'ollama':
      return createOllamaProvider({ baseUrl: config.baseUrl })
    case 'openai':
      return createOpenAIProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey })
    case 'anthropic':
      throw new ProviderError(`The "${config.label}" provider isn't wired yet (arrives in P3-T4).`)
    default: {
      // Exhaustiveness guard: a new ProviderKind must add a case above.
      const _never: never = config.kind
      throw new ProviderError(`Unknown provider kind: ${String(_never)}`)
    }
  }
}
