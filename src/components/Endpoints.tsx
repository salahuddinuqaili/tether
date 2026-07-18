import { useEffect, useMemo, useState } from 'react'
import {
  deleteEndpoint,
  defaultEndpoint,
  getActiveEndpointId,
  getActiveModel,
  getEndpoints,
  migrateLegacyOllama,
  newEndpointId,
  setActiveEndpointId,
  setActiveModelForEndpoint,
  upsertEndpoint,
} from '../storage/providers'
import { listOllamaModels, type EndpointConfig, type ProviderKind } from '../llm/providers'

// Endpoint manager (P3-T2). Replaces the Phase 2 single "Desktop model" block:
// configure one or more LLM endpoints — the local Ollama and, once T3/T4 wire the
// adapters, cloud providers (OpenRouter, Anthropic) — persisted on-device (D4/D8).
// The active endpoint + model is the chat's binding until T5 lifts selection onto
// the chat page. apiKeys are spendable secrets: entered here, never displayed back
// (same posture as the PAT).

const KIND_LABEL: Record<ProviderKind, string> = {
  ollama: 'Ollama (desktop)',
  openai: 'OpenRouter / OpenAI-compatible',
  anthropic: 'Anthropic (Claude API)',
}

const MODEL_HINT: Partial<Record<ProviderKind, string>> = {
  openai: 'e.g. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet',
  anthropic: 'e.g. claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022',
}

export function Endpoints() {
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([])
  const [activeId, setActiveId] = useState<string | undefined>()
  const [activeModel, setActiveModel] = useState<string | undefined>()
  const [editing, setEditing] = useState<EndpointConfig | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const [eps, aid, am] = await Promise.all([getEndpoints(), getActiveEndpointId(), getActiveModel()])
    setEndpoints(eps)
    setActiveId(aid)
    setActiveModel(am)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await migrateLegacyOllama() // seed an Ollama endpoint from a Phase 2 install
      if (cancelled) return
      await refresh()
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function startAdd(kind: ProviderKind) {
    setEditing({ id: newEndpointId(), ...defaultEndpoint(kind) })
  }

  async function onSave(cfg: EndpointConfig) {
    await upsertEndpoint(cfg)
    // First endpoint added becomes active automatically.
    if (!activeId) {
      await setActiveEndpointId(cfg.id)
      if (cfg.model) await setActiveModelForEndpoint(cfg.id, cfg.model)
    } else if (cfg.id === activeId && cfg.model) {
      await setActiveModelForEndpoint(cfg.id, cfg.model)
    }
    setEditing(null)
    await refresh()
  }

  async function onRemove(id: string) {
    await deleteEndpoint(id)
    await refresh()
  }

  async function onMakeActive(ep: EndpointConfig) {
    await setActiveEndpointId(ep.id)
    if (ep.model) await setActiveModelForEndpoint(ep.id, ep.model)
    await refresh()
  }

  const isFirst = endpoints.length === 0

  return (
    <div className="flex flex-col gap-3 border-t border-white/10 pt-5">
      <div>
        <h2 className="text-base font-semibold">Model endpoints</h2>
        <p className="mt-1 text-sm text-muted">
          Configure where tether sends chat — your desktop Ollama and, soon, cloud providers. The
          active one drives the chat. Keys live only on this device and are never displayed back.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading endpoints…</p>
      ) : (
        <>
          {endpoints.length > 0 && (
            <ul className="flex flex-col gap-2">
              {endpoints.map((ep) => (
                <EndpointRow
                  key={ep.id}
                  ep={ep}
                  active={ep.id === activeId}
                  activeModel={ep.id === activeId ? activeModel : undefined}
                  onEdit={() => setEditing(ep)}
                  onRemove={() => onRemove(ep.id)}
                  onMakeActive={() => onMakeActive(ep)}
                />
              ))}
            </ul>
          )}

          {editing ? (
            <EndpointForm
              key={editing.id}
              initial={editing}
              existing={endpoints.find((e) => e.id === editing.id)}
              onCancel={() => setEditing(null)}
              onSave={onSave}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-xs text-muted">{isFirst ? 'Add an endpoint:' : 'Add another:'}</span>
              {(['ollama', 'openai', 'anthropic'] as ProviderKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => startAdd(k)}
                  className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                >
                  + {k === 'ollama' ? 'Ollama' : k === 'openai' ? 'OpenRouter' : 'Claude'}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EndpointRow({
  ep,
  active,
  activeModel,
  onEdit,
  onRemove,
  onMakeActive,
}: {
  ep: EndpointConfig
  active: boolean
  activeModel?: string
  onEdit: () => void
  onRemove: () => void
  onMakeActive: () => void
}) {
  const model = active ? activeModel ?? ep.model : ep.model
  return (
    <li
      className={`flex items-center gap-2 rounded-lg border p-3 ${
        active ? 'border-accent/40 bg-accent/5' : 'border-white/10 bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={onMakeActive}
        disabled={active}
        aria-label={active ? 'Active endpoint' : 'Make active'}
        title={active ? 'Active endpoint' : 'Make active'}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
          active ? 'border-accent' : 'border-white/30 hover:border-white/60'
        }`}
      >
        {active && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{ep.label}</span>
          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
            {ep.kind === 'ollama' ? 'ollama' : ep.kind === 'openai' ? 'openai' : 'anthropic'}
          </span>
          {ep.apiKey && <span className="shrink-0 text-[10px] text-accent/80" title="API key saved">🔑</span>}
        </div>
        <div className="truncate text-xs text-muted">{ep.baseUrl || '(no URL set)'}</div>
        <div className="truncate text-xs text-muted">
          model: {model ? <span className="text-white/70">{model}</span> : <span className="text-white/40">none picked</span>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        <button type="button" onClick={onEdit} className="rounded px-2 py-0.5 text-xs text-white/70 hover:bg-white/10">
          Edit
        </button>
        <button type="button" onClick={onRemove} className="rounded px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10">
          Remove
        </button>
      </div>
    </li>
  )
}

function EndpointForm({
  initial,
  existing,
  onCancel,
  onSave,
}: {
  initial: EndpointConfig
  existing?: EndpointConfig
  onCancel: () => void
  onSave: (cfg: EndpointConfig) => Promise<void>
}) {
  const [label, setLabel] = useState(initial.label)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model ?? '')
  // Never prefill a saved key. Blank on an existing endpoint = keep the old key.
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const isCloud = initial.kind === 'openai' || initial.kind === 'anthropic'
  const hadKey = Boolean(existing?.apiKey)

  function build(): EndpointConfig {
    const next: EndpointConfig = {
      id: initial.id,
      kind: initial.kind,
      label: label.trim() || KIND_LABEL[initial.kind],
      baseUrl: baseUrl.trim(),
      ...(model.trim() ? { model: model.trim() } : {}),
    }
    if (isCloud) {
      const key = apiKey.trim() || (existing?.apiKey ?? '')
      if (key) next.apiKey = key
    }
    return next
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(build())
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-lg border border-white/15 bg-surface p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/50">
        {existing ? 'Edit' : 'New'} · {KIND_LABEL[initial.kind]}
      </div>

      <Field label="Label">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder={KIND_LABEL[initial.kind]} />
      </Field>

      <Field label={initial.kind === 'ollama' ? 'Tailscale Serve URL' : 'API base URL'}>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={initial.kind === 'ollama' ? 'https://your-machine.your-tailnet.ts.net' : 'https://…'}
          className={inputCls}
        />
      </Field>

      {isCloud && (
        <Field label={hadKey ? 'API key (saved — leave blank to keep)' : 'API key'}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={hadKey ? '•••••••• (unchanged)' : 'sk-…'}
            className={inputCls}
          />
        </Field>
      )}

      {initial.kind === 'ollama' ? (
        <OllamaModelPicker baseUrl={baseUrl} model={model} onPick={setModel} />
      ) : (
        <Field label="Model">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={MODEL_HINT[initial.kind]}
            className={inputCls}
          />
        </Field>
      )}

      <div className="mt-1 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !baseUrl.trim()}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save endpoint'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-muted hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  )
}

// Ollama's live reachability test doubles as the model picker (the Phase 2 UX),
// now scoped to one endpoint's URL. A real cross-origin GET proves the endpoint
// works before it's saved.
function OllamaModelPicker({ baseUrl, model, onPick }: { baseUrl: string; model: string; onPick: (m: string) => void }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [models, setModels] = useState<string[]>([])
  const [detail, setDetail] = useState('')

  async function test() {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!url) return
    setState('testing')
    setDetail('')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const names = await listOllamaModels(url, controller.signal)
      setModels(names)
      setState('ok')
      if (!model && names.length) onPick(names[0])
    } catch (e) {
      setState('fail')
      setDetail(controller.signal.aborted ? 'Timed out reaching the endpoint.' : e instanceof Error ? e.message : 'fetch failed')
    } finally {
      clearTimeout(timer)
    }
  }

  const options = useMemo(() => {
    const set = new Set(models)
    if (model) set.add(model)
    return Array.from(set)
  }, [models, model])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={!baseUrl.trim() || state === 'testing'}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          {state === 'testing' ? 'Testing…' : 'Test & load models'}
        </button>
        {state === 'ok' && <span className="text-xs text-accent">✓ reachable ({models.length} models)</span>}
        {state === 'fail' && <span className="break-words text-xs text-red-400">✗ {detail}</span>}
      </div>

      <Field label="Model">
        {options.length > 0 ? (
          <select value={model} onChange={(e) => onPick(e.target.value)} className={inputCls}>
            {!model && (
              <option value="" disabled>
                Select a model…
              </option>
            )}
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={model}
            onChange={(e) => onPick(e.target.value)}
            placeholder="Test to load, or type a model name"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={inputCls}
          />
        )}
      </Field>
    </div>
  )
}

const inputCls = 'rounded-md border border-white/10 bg-bg px-3 py-2 text-sm outline-none focus:border-accent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-white/60">{label}</span>
      {children}
    </label>
  )
}
