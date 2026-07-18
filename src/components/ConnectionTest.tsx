import { useEffect, useMemo, useState } from 'react'
import {
  clearModel as clearStoredModel,
  clearOllamaUrl,
  getModel as getStoredModel,
  getOllamaUrl,
  setModel as setStoredModel,
  setOllamaUrl,
} from '../storage/llm'
import { listOllamaModels as listModels } from '../llm/providers'

// Desktop-model settings (P2-T1). Two jobs in one block: (1) the Phase 2 transport
// spike (S3/S4) — a real cross-origin fetch from the installed PWA to the desktop
// Ollama endpoint, proving the phone can reach the model over HTTPS; and (2) the
// model picker — choose which model the agent uses, from the endpoint's /api/tags
// list. URL + model are runtime config (DECISIONS D4), never hardcoded.
type Result =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'pass'; models: string[] }
  | { state: 'fail'; detail: string }

const TEST_TIMEOUT_MS = 20_000

export function ConnectionTest() {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<Result>({ state: 'idle' })
  // The persisted model choice and the available models (from the last successful
  // /api/tags fetch — either an explicit test or the best-effort load on mount).
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      const [storedUrl, storedModel] = await Promise.all([getOllamaUrl(), getStoredModel()])
      if (cancelled) return
      if (storedUrl) {
        setSaved(storedUrl)
        setUrl(storedUrl)
      }
      if (storedModel) setSelectedModel(storedModel)
      // Best-effort: populate the picker without making the user hit "Test" first.
      // Silent on failure — the desktop may simply be asleep; the picker then falls
      // back to showing the saved model as its only option.
      if (storedUrl) {
        try {
          const names = await listModels(storedUrl, controller.signal)
          if (!cancelled) setModels(names)
        } catch {
          /* offline / unreachable — leave models empty, no error surfaced here */
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // The dropdown always includes the saved model even if a fresh list hasn't loaded
  // (e.g. desktop asleep), so the current choice is visible and stays selected.
  const modelOptions = useMemo(() => {
    const set = new Set(models)
    if (selectedModel) set.add(selectedModel)
    return Array.from(set)
  }, [models, selectedModel])

  async function onTest() {
    const target = url.trim().replace(/\/+$/, '')
    if (!target) return
    setResult({ state: 'testing' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    try {
      await setOllamaUrl(target)
      setSaved(target)
      // Real cross-origin GET from the PWA origin. /api/tags proves reachability +
      // valid cert + CORS at once, and doubles as the model list for the picker.
      const names = await listModels(target, controller.signal)
      setModels(names)
      setResult({ state: 'pass', models: names })
    } catch (e) {
      // A thrown fetch here is the classic S3/S4 failure: cert not trusted, host
      // unreachable, iOS mixed-content/security block, or CORS (origin not in
      // OLLAMA_ORIGINS). The browser hides which — surface the likely causes.
      const detail = controller.signal.aborted
        ? 'Timed out reaching the endpoint.'
        : e instanceof Error
          ? e.message
          : 'fetch failed'
      setResult({ state: 'fail', detail })
    } finally {
      clearTimeout(timer)
    }
  }

  async function onSelectModel(value: string) {
    setSelectedModel(value)
    if (!value) return
    // Persist immediately; non-fatal if the write fails (picker still reflects it).
    try {
      await setStoredModel(value)
    } catch {
      /* IndexedDB write failed — the in-memory choice still drives this session */
    }
  }

  async function onClear() {
    await clearOllamaUrl()
    await clearStoredModel()
    setSaved(undefined)
    setUrl('')
    setSelectedModel('')
    setModels([])
    setResult({ state: 'idle' })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
      <div>
        <h2 className="text-base font-semibold">Desktop model</h2>
        <p className="mt-1 text-sm text-muted">
          Enter your Tailscale Serve URL and test that this installed app can reach your Ollama over
          HTTPS, then pick the model the agent should use. Nothing is committed — it lives only on
          this device.
        </p>
      </div>

      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://your-machine.your-tailnet.ts.net"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="url"
        className="rounded-md border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTest}
          disabled={!url.trim() || result.state === 'testing'}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {result.state === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        {saved && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-white/10 px-3 py-2 text-sm text-muted hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {modelOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="model-picker" className="text-sm font-medium">
            Model
          </label>
          <select
            id="model-picker"
            value={selectedModel}
            onChange={(e) => void onSelectModel(e.target.value)}
            className="rounded-md border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {!selectedModel && (
              <option value="" disabled>
                Select a model…
              </option>
            )}
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            The agent runs on this model. Test the connection to refresh the list.
          </p>
        </div>
      )}

      {result.state === 'pass' && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
          <p className="font-semibold text-accent">✓ Reachable — the phone can talk to your model.</p>
          <p className="mt-1 text-muted">
            {result.models.length
              ? `${result.models.length} model${result.models.length === 1 ? '' : 's'} available — pick one above.`
              : 'Connected, but no models are pulled yet.'}
          </p>
        </div>
      )}

      {result.state === 'fail' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
          <p className="font-semibold text-red-400">✗ Could not reach the endpoint.</p>
          <p className="mt-1 break-words text-muted">{result.detail}</p>
          <ul className="mt-2 list-disc pl-4 text-xs text-muted">
            <li>
              Allow this origin on the desktop:{' '}
              <code className="text-white/80">OLLAMA_ORIGINS={origin()}</code> then restart Ollama.
            </li>
            <li>Confirm the URL opens in Safari on the phone (valid cert, no warning).</li>
            <li>Confirm the phone is on the tailnet and the desktop is awake.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function origin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'https://<user>.github.io'
}
