import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { createProvider, type EndpointConfig } from '../llm/providers'
import {
  getActiveEndpointId,
  getActiveModel,
  getEndpoints,
  setActiveEndpointId,
  setActiveModelForEndpoint,
} from '../storage/providers'

// Chat-page endpoint/model picker (P3-T5). Lifts model selection out of Settings
// onto the chat surface: a compact pill showing the active endpoint · model that
// opens a dropdown to switch either. It writes the active {endpoint, model} to the
// same store ChatProvider reads at send time (getActiveBinding), so the *next*
// message uses the new binding — no shared React state, IndexedDB is the source of
// truth. Endpoints are configured in Settings (T2); this only selects among them.
export function ChatModelPicker() {
  const { setView } = useStore()
  const [endpoints, setEndpoints] = useState<EndpointConfig[]>([])
  const [activeId, setActiveId] = useState<string | undefined>()
  const [activeModel, setActiveModel] = useState<string | undefined>()
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [eps, aid, am] = await Promise.all([getEndpoints(), getActiveEndpointId(), getActiveModel()])
    setEndpoints(eps)
    setActiveId(aid)
    setActiveModel(am)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const active = useMemo(
    () => endpoints.find((e) => e.id === activeId) ?? endpoints[0],
    [endpoints, activeId],
  )

  // Load the active endpoint's model list (best-effort). Ollama hits /api/tags,
  // cloud hits /models; on failure the picker still offers the remembered model.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const controller = new AbortController()
    setLoadingModels(true)
    createProvider(active)
      .listModels(controller.signal)
      .then((ms) => !cancelled && setModels(ms))
      .catch(() => !cancelled && setModels([]))
      .finally(() => !cancelled && setLoadingModels(false))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [active])

  // Close the dropdown on an outside tap.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  async function pickEndpoint(id: string) {
    await setActiveEndpointId(id)
    const ep = endpoints.find((e) => e.id === id)
    if (ep?.model) await setActiveModelForEndpoint(id, ep.model)
    setActiveId(id)
    setActiveModel(ep?.model)
  }

  async function pickModel(m: string) {
    if (!active) return
    await setActiveModelForEndpoint(active.id, m)
    setActiveModel(m)
    setOpen(false)
  }

  const modelOptions = useMemo(() => {
    const set = new Set(models)
    const current = activeModel ?? active?.model
    if (current) set.add(current)
    return Array.from(set)
  }, [models, activeModel, active])

  // No endpoints configured yet → a prompt to set one up in Settings.
  if (endpoints.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setView('settings')}
        className="min-w-0 truncate rounded-md border border-accent/30 bg-accent/5 px-2 py-1 text-xs text-accent"
      >
        + Set up a model endpoint
      </button>
    )
  }

  const currentModel = activeModel ?? active?.model
  const label = active ? active.label : 'No endpoint'

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
        title="Switch model / endpoint"
      >
        <span className="truncate font-medium text-white/90">{label}</span>
        <span className="shrink-0 text-white/40">·</span>
        <span className="truncate text-white/60">{currentModel ?? 'pick model'}</span>
        <span className="shrink-0 text-white/40">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[90vw] rounded-lg border border-white/15 bg-surface p-2 shadow-xl">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-white/40">Endpoint</div>
          <div className="flex flex-col">
            {endpoints.map((ep) => (
              <button
                key={ep.id}
                type="button"
                onClick={() => pickEndpoint(ep.id)}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/10 ${
                  ep.id === active?.id ? 'text-accent' : 'text-white/80'
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ep.id === active?.id ? 'bg-accent' : 'bg-white/20'}`} />
                <span className="truncate">{ep.label}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase text-white/40">{ep.kind}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-white/40">
            Model {loadingModels && <span className="text-white/30">· loading…</span>}
          </div>
          {modelOptions.length > 0 ? (
            <select
              value={currentModel ?? ''}
              onChange={(e) => void pickModel(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {!currentModel && (
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
          ) : (
            <div className="px-1 text-xs text-white/50">
              No models loaded.{' '}
              <button type="button" onClick={() => setView('settings')} className="text-accent underline">
                Configure in Settings
              </button>
              .
            </div>
          )}
        </div>
      )}
    </div>
  )
}
