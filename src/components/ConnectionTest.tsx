import { useEffect, useState } from 'react'
import { clearOllamaUrl, getOllamaUrl, setOllamaUrl } from '../storage/llm'

// Phase 2 transport spike (S3/S4), not chat UI. Does the real cross-origin fetch
// from the installed PWA to the desktop Ollama endpoint and reports pass/fail —
// the make-or-break check that the phone can reach the model over HTTPS before
// any LLM feature is built. The URL is runtime config (DECISIONS D4), never
// hardcoded.
type Result =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'pass'; models: string[] }
  | { state: 'fail'; detail: string }

export function ConnectionTest() {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<Result>({ state: 'idle' })

  useEffect(() => {
    getOllamaUrl().then((stored) => {
      if (stored) {
        setSaved(stored)
        setUrl(stored)
      }
    })
  }, [])

  async function onTest() {
    const target = url.trim().replace(/\/+$/, '')
    if (!target) return
    setResult({ state: 'testing' })
    try {
      await setOllamaUrl(target)
      setSaved(target)
      // Real cross-origin GET from the PWA origin. /api/tags is enough to prove
      // reachability + valid cert + CORS (Access-Control-Allow-Origin) at once.
      const res = await fetch(`${target}/api/tags`, { method: 'GET' })
      if (!res.ok) {
        setResult({ state: 'fail', detail: `Endpoint answered HTTP ${res.status}.` })
        return
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> }
      setResult({ state: 'pass', models: (data.models ?? []).map((m) => m.name) })
    } catch (e) {
      // A thrown fetch here is the classic S3/S4 failure: cert not trusted, host
      // unreachable, iOS mixed-content/security block, or CORS (origin not in
      // OLLAMA_ORIGINS). The browser hides which — surface the likely causes.
      setResult({
        state: 'fail',
        detail: e instanceof Error ? e.message : 'fetch failed',
      })
    }
  }

  async function onClear() {
    await clearOllamaUrl()
    setSaved(undefined)
    setUrl('')
    setResult({ state: 'idle' })
  }

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
      <div>
        <h2 className="text-base font-semibold">Desktop model — connection test</h2>
        <p className="mt-1 text-sm text-muted">
          Phase 2 check: can this installed app reach your Ollama over HTTPS? Enter your Tailscale
          Serve URL and test. Nothing is committed — it lives only on this device.
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

      {result.state === 'pass' && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm">
          <p className="font-semibold text-accent">✓ Reachable — the phone can talk to your model.</p>
          <p className="mt-1 text-muted">
            {result.models.length
              ? `Models: ${result.models.join(', ')}`
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
