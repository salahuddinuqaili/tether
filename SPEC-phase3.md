# SPEC — Phase 3: Multi-provider thin client (foundation of the desktop-agent pivot)

> Status: Draft for implementation. Written after the 2026-07-17 product review
> (`docs/feedback-2026-07-17-desktop-agent-direction.md`) and the direction call:
> **full pivot** — tether becomes a thin client for capable agent *endpoints*, not a
> smart GitHub editor. This phase builds the **foundation** for that (the provider
> abstraction + cloud endpoints + chat-page model selection + nav clarity) **without**
> reversing any locked decision. The desktop-agent endpoint (fam-x / Claude Code),
> GitHub-editor retirement, and the DECISIONS reversals are **Phase 4** — gated on fam-x
> exposing a servable API. **Multiple concurrent sessions (multi-chat) are IN scope this
> phase**, elevated from 3.5 per follow-up feedback (2026-07-18). Implement in a **fresh
> session**; branch `feat/phase-3-providers` off `main`.

## 1. Goal & stop signal

Make tether speak to **more than one LLM endpoint** — the local desktop model (Ollama,
today) **and** cloud providers (OpenRouter, Anthropic API) — through **one provider
abstraction**, choose the provider+model **on the chat page**, and navigate the app
**without guessing**.

**Stop signal:** from the phone, run **two chat sessions at once** — switch each between a
**local Ollama model** and a **cloud model (OpenRouter)** with an on-page picker, and get a
**streamed** reply in each (a cloud session streaming while a second session is live proves
real concurrency) — and it's obvious how to move between Chat / repo / Settings.

## 2. Direction context (why this shape)

The review's six points reduce to *one architectural move + three niceties* (full analysis
in the feedback doc). The move — "let the AI access the desktop + internet" — requires a
**desktop agent runtime** tether points at instead of raw Ollama; that is **Phase 4** and
depends on **fam-x** growing an HTTP/SSE agent API (today `fam` is a terminal binary). This
phase builds everything that is (a) on the direct path to that end-state and (b) reverses
**no** locked decision, because OpenRouter and the Anthropic API are real, browser-callable
agent endpoints that let us prove the "tether talks to arbitrary endpoints" thesis **before**
fam-x is ready.

**Kept, not deleted, this phase:** GitHub browse/open/edit/diff/commit (Phase 1/2) stays
fully functional — demoted to "one capability," retired only in Phase 4 when the desktop
agent can replace it. Do not strand the phone with no way to edit code mid-transition.

## 3. Spike — validate cloud reachability BEFORE building UI (mirror the Phase 2 gate)

The Phase 2 premise was "an HTTPS PWA can reach `http` Ollama"; it was spiked first. The
Phase 3 premise is "the installed iOS PWA can call **cloud** provider APIs directly from the
browser." Prove it cheaply first, on the **real iPhone in standalone mode**, with `curl` /
a test button — not React components.

- **S-P3-1 — OpenRouter from the PWA origin.** `POST https://openrouter.ai/api/v1/chat/completions`
  with `Authorization: Bearer <key>`, `stream:true`. **Pass:** CORS allows the github.io
  origin; SSE chunks arrive. **Fail → fix:** proxy needed (reconsider — a proxy reintroduces
  a backend).
- **S-P3-2 ❗ — Anthropic direct browser access.** `POST https://api.anthropic.com/v1/messages`
  with `x-api-key`, `anthropic-version`, and **`anthropic-dangerous-direct-browser-access: true`**,
  `stream:true`. **Pass:** the preflight + SSE succeed from the installed PWA. **Fail →
  architecture:** if Anthropic can't be called browser-direct on iOS standalone, Anthropic-API
  support waits for the Phase 4 desktop agent (which can proxy it); OpenRouter still stands.
- **S-P3-3 — streaming actually streams** (SSE, both providers) — chunks arrive progressively,
  as validated for Ollama in P2-T2.

Record results in `docs/spikes-phase3.md`. **Build UI only once S-P3-1 (and ideally S-P3-2)
pass.** These are config/architecture gates, not code.

## 4. Architecture

### 4.1 Provider abstraction — `src/llm/providers/`
The keystone. Generalize today's Ollama-specific `src/llm/client.ts` into a `Provider`
interface; every endpoint is an adapter.

```ts
interface Provider {
  // Streamed chat. Emits content deltas via onToken; returns the assembled message
  // (content + normalized tool_calls). Abortable. think-flag / SSE-vs-NDJSON handled here.
  chat(params: ProviderChatParams): Promise<ChatResponse>
  // Discover selectable models for this endpoint (Ollama /api/tags, OpenRouter /models,
  // a curated list for Anthropic). Returns [] if not enumerable.
  listModels(signal?: AbortSignal): Promise<string[]>
}
```

Adapters (each owns its wire format + tool-call shape + stream framing):
- `providers/ollama.ts` — refactor of the current `client.ts` (NDJSON, `think` flag, Ollama
  tool-call shape + the D10 leaked-JSON fallback).
- `providers/openai.ts` — OpenAI-compatible (**OpenRouter** first; also any other OpenAI-compat
  endpoint). SSE `data:` frames, `tool_calls` delta assembly, `/v1/models`.
- `providers/anthropic.ts` — `/v1/messages`, `anthropic-dangerous-direct-browser-access`, SSE
  `content_block_delta`, `tool_use` blocks; curated model list.

The **agent loop** (`src/llm/agent.ts`) becomes provider-agnostic: it calls
`provider.chat(...)` instead of the Ollama `chat()`. Native `tool_calls` come normalized from
the adapter; the leaked-JSON `read_file` fallback (D10) stays for weak local models. `read_file`
executor (GitHub-backed) is unchanged.

### 4.2 Endpoint config — `src/storage/providers.ts`
Extend the `src/storage/llm.ts` IndexedDB pattern (D8/D4 posture). A list of configured
endpoints + the active selection:

```ts
interface EndpointConfig {
  id: string
  kind: 'ollama' | 'openai' | 'anthropic'
  label: string          // "Desktop (Ollama)", "OpenRouter", "Claude"
  baseUrl: string        // ollama URL / https://openrouter.ai/api/v1 / https://api.anthropic.com
  apiKey?: string        // OpenRouter / Anthropic key — on-device only, never committed
  model?: string         // last-selected model for this endpoint
}
// plus: activeEndpointId + activeModel (the chat's current binding)
```
Keep `ollama_url` / `ollama_model` readable for a one-time migration into an EndpointConfig.

### 4.3 Chat-page model/endpoint picker
A compact selector in the chat header (or above the composer) listing **endpoint × model**;
changing it updates the active `{endpoint, model}` for the (single, this phase) chat and
persists it. Reuses each provider's `listModels()`. This mostly lifts the existing Settings
`<select>` + `/api/tags` fetch onto the chat surface (feedback #2).

### 4.4 Navigation redesign (feedback #1)
Replace the faint repo pill + tiny ⚙ with an obvious, **labeled** way to move between
**Chat / Browse (GitHub) / Settings** — a bottom tab bar (thumb-reachable, safe-area aware)
or a visible header menu. Keep the §3 keyboard-pinned composer intact. Also **defuse the
change-repo bug**: `clearRepo()` destroys the selection with no undo (`Browse.tsx`) — don't
null the selection until a new repo is chosen (or drop the flow if nav makes it redundant).

### 4.5 Security note (call it out, don't hand-wave)
OpenRouter/Anthropic keys are **spendable credentials** living in on-device IndexedDB, sent
straight from the browser — same posture as the PAT (D8), but money, not just repo scope.
Store them like the PAT (never logged/committed/displayed); make removal easy; scope/limits
are the user's call. This is acceptable for single-user; note it in DECISIONS.

### 4.6 Sessions layer — multiple concurrent chats (feedback #5)
Today's `ChatProvider` assumes **one** conversation (one `messages`, one `AbortController`,
one global streaming channel in `src/chat/streaming.ts`). Generalize to a **sessions** model:

```ts
interface Session {
  id: string
  title: string                 // derived from the first message
  endpointId: string            // which configured endpoint (§4.2)
  model: string
  messages: UiMessage[]
  status: AgentStatus
  // each session owns its own AbortController + streaming buffer (no global singleton)
}
```
- Per-session streaming: replace the single global streaming store with one keyed by session
  id (the active bubble subscribes to *its* session's channel), preserving the §3 "only the
  streaming bubble re-renders" guarantee.
- A **session switcher** (list / tabs) to create, switch, and close chats; persist sessions
  (OPFS, like the edit session) so they survive reload.
- **Concurrency is real across endpoints**: sessions bound to different endpoints stream in
  parallel; sessions on the same Ollama box serialize on the GPU (one model in VRAM) — surface
  that honestly (a queued indicator), don't pretend otherwise. `OLLAMA_NUM_PARALLEL` can allow
  some same-box parallelism but is the user's server config, not tether's concern.
- The model/endpoint picker (§4.3) binds to the **active** session.

## 5. Build order (each with an acceptance check)

- **S-P3 spikes** — cloud reachability (§3). Gate before UI.
- **P3-T1** Provider abstraction: define `Provider`; refactor Ollama into `providers/ollama.ts`;
  agent loop calls the provider. **Acceptance:** existing Ollama chat + `read_file` + edit
  proposal still work unchanged through the abstraction (regression, all P2 checks green).
- **P3-T2** Endpoint config store + Settings UI to add/edit endpoints (Ollama URL, OpenRouter
  key, Anthropic key), with migration of the existing `ollama_url`/`ollama_model`.
  **Acceptance:** configure two endpoints; both persist across reload.
- **P3-T3** OpenAI-compat adapter (OpenRouter): streaming + tool-call normalization + `/models`.
  **Acceptance:** send to an OpenRouter model → streamed reply on-device (user runs, real key).
- **P3-T4** Anthropic adapter (direct browser access): streaming + tool_use. **Acceptance:**
  streamed reply from a Claude model on-device (gated on S-P3-2; else defer to Phase 4).
- **P3-T5** Chat-page endpoint/model picker bound to the active chat. **Acceptance:** switch
  provider/model in chat → the next message uses it (proven for local↔cloud).
- **P3-T6** Nav redesign + change-repo bug fix. **Acceptance:** on-device, moving between
  Chat/Browse/Settings is obvious; changing repo and backing out never strands you.
- **P3-T7** Sessions layer (§4.6): multiple concurrent chats, each bound to an `{endpoint,
  model}`, per-session streaming + abort, a switcher, OPFS persistence. **Acceptance:** open
  two sessions on different endpoints; both stream concurrently; switching between them is
  instant and each keeps its own history; a same-Ollama-box second session shows a queued
  state rather than corrupting the first.
- **Stop signal** at P3-T5 + P3-T7 (two concurrent sessions, local↔cloud, both stream) and
  P3-T6 (clear nav).

## 6. Non-goals (Phase 3)

- **Desktop-agent endpoint / fam-x / Claude Code** (Phase 4 — gated on fam-x's server).
- **Retiring GitHub editor / diff / commit** (Phase 4, when the agent replaces it).
- **The Claude *subscription*** (Phase 4, via Claude Code as an endpoint — NOT by scraping
  claude.ai, and NOT the same as fam-x's API-key routing).
- **DECISIONS reversals** (no locked decision is reversed this phase; that's Phase 4).
- **True same-box parallelism** for concurrent Ollama sessions — not tether's job; it surfaces
  the GPU-serialized reality (queued indicator) rather than working around it.

## 7. Risks

- **Cloud CORS / browser-direct calls** (S-P3-1/2) — the make-or-break gate; a proxy would
  reintroduce a backend, so validate first.
- **Three stream framings** (Ollama NDJSON, OpenAI SSE, Anthropic SSE) and **three tool-call
  shapes** → the adapter boundary must fully own parsing + normalization; keep the agent loop
  format-blind.
- **Spendable keys in client storage** (§4.5).
- **Provider drift** — model lists / endpoints change; keep them runtime config (D4), never
  hardcoded.
- **Scope creep toward Phase 4** — resist wiring desktop tools now; this phase is endpoints +
  selection + nav only.
