# DECISIONS.md — tether

Architecture decision record for `tether`. Captures every **locked** choice carried
forward from `PRD.md`, plus the **open** decisions surfaced during planning and their
resolutions. Update this file whenever a decision changes; it is the single source of
truth for "why is it built this way."

Legend: 🔒 LOCKED (from PRD) · ✅ RESOLVED (confirmed this session) · ❓ OPEN (still needs a call)

---

## 1. Locked decisions (from PRD)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 🔒 1 | App model | **Progressive Web App**, installed to iPhone home screen | No App Store, no Mac build toolchain, no native iOS. Ships from web tech alone. |
| 🔒 2 | Client role | **Thin client** — editing on phone, inference on desktop | Phone never runs a model; the RTX rig is the brain. |
| 🔒 3 | Source of truth | **GitHub** | Phone storage is a disposable cache, never canonical. |
| 🔒 4 | Backend | **None** | No server, no database. Browser talks directly to GitHub + Ollama. |
| 🔒 5 | Editor | **CodeMirror 6** | Touch ergonomics, modular, small bundle. Monaco is desktop-first and heavy. |
| 🔒 6 | GitHub access | **REST API via fine-grained PAT**; Contents API (single-file) for MVP, Git Data API (multi-file atomic) later | GitHub API supports CORS → browser can call it directly. |
| 🔒 7 | LLM transport | **Ollama `/api/chat` (streaming)** over **Tailscale MagicDNS** | Reaches the desktop model from anywhere on the tailnet. |
| 🔒 8 | Mixed-content fix | **Tailscale Serve** TLS in front of Ollama (`https://*.ts.net`) | An HTTPS PWA cannot call `http://` Ollama; Serve provides a real cert. The linchpin. |
| 🔒 9 | Local persistence | **OPFS** for file buffers, **IndexedDB** for settings + token | Both supported on iOS Safari. |
| 🔒 10 | PWA shell | **Web App Manifest** (standalone) + **service worker** (app-shell + asset cache) | Required for installability and offline app shell. |
| 🔒 11 | Styling | **Tailwind**, dark-first, accent ≈ `#00FF66` ("Kinetic Darkroom" family) | Visual continuity with Pulse. |
| 🔒 12 | Networking | **Tailscale** (desktop + phone on one tailnet, Serve for TLS); ACLs scope Ollama to own devices | Private, no port-forwarding, no public exposure. |
| 🔒 13 | Security posture | Fine-grained PAT, **contents read/write only**, scoped repos, short expiry; token on-device only, never committed | Minimize blast radius of leakage. |

**Non-goals reaffirmed (do NOT build):** native iOS / App Store, on-device LLM,
code execution / terminal / shell on the phone, multi-user / accounts / collaboration,
per-language tooling beyond CodeMirror defaults.

> Single-user remains locked — but now understood as **single-user *per instance*** (each
> self-hoster runs their own). A hosted multi-tenant service is deferred, not adopted — see D4 / O5.

---

## 2. Open decisions — resolved this session

### ✅ D1 — Framework: **Vite + React**
*Confirmed.* Lightest static-PWA path; `vite-plugin-pwa` generates the manifest and a
Workbox service worker with near-zero config. No SSR / App Router baggage to fight when
the whole app is client-side and there is no backend. Fastest dev loop for a solo build.
> Rejected: Next.js 14 static export — `output: export` works but adds friction around
> service-worker integration and routing for an app that is pure client-side.

### ✅ D2 — Static host: **GitHub Pages**
*Confirmed.* Keeps hosting in the same GitHub account as the repos and PAT; HTTPS by
default on the Pages domain (required for PWA install); one-line deploy via GitHub
Actions. No extra vendor to wire up.
> Rejected for now: Cloudflare Pages (better header/cache control, keep as fallback if
> SW cache tuning needs it), Vercel (DX overkill for a static no-backend app).
> **Note:** GitHub Pages serves under a sub-path (`/<repo>/`). Set Vite `base` and the
> manifest `start_url`/`scope` accordingly, and use **hash-based routing** (or a single
> view) to avoid 404s on deep links. Tracked as a Phase 0 task.

### ✅ D3 — CodeMirror 6 extension set (MVP baseline)
*My recommendation — adopt unless you object; cheap to revise.* Keep it minimal and
touch-first:
- **Core:** `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` (history, default keymap).
- **Languages (lazy-loaded per file extension):** `@codemirror/lang-javascript` (JS/TS/JSX/TSX), `@codemirror/lang-markdown`, `@codemirror/lang-json`, `@codemirror/lang-python`, `@codemirror/lang-html`, `@codemirror/lang-css`. Fall back to plain text for unknown extensions. Dynamic `import()` so we don't ship every grammar up front.
- **Editing aids:** `lineNumbers`, `highlightActiveLine`, `closeBrackets`, `bracketMatching`, `indentOnInput`, `highlightSelectionMatches`.
- **Theme:** `@codemirror/theme-one-dark` as a starting dark theme, retinted toward `#00FF66` later (Phase 3 polish).
- **Touch:** `EditorView.lineWrapping` ON (no horizontal scroll on a phone); revisit a custom mobile key-accessory bar in a Phase 0 UX spike.
- **Deliberately deferred:** linting, autocompletion/LSP, multi-cursor, vim mode, search panel — none are MVP, several hurt touch UX.

### ✅ D4 — Distribution posture: open-source & self-hostable; hosted service deferred
*Confirmed.* tether ships **open source**, designed so anyone can **self-host their own instance** —
each user brings their own GitHub PAT and their own local model (their Ollama, their tailnet). The
PRD's single-user design is **preserved and still locked**: single-user *per instance*, not
multi-tenant. A **hosted multi-user service on shared hardware is explicitly deferred** (see O5),
not adopted — so none of the multi-user machinery (auth, vLLM concurrency, public exposure) enters
scope now.
> **The one delta this forces — configurable from day one, no hardcoded anything:** GitHub PAT,
> Ollama base URL, model name, and the PWA origin are all **runtime settings**, never baked into
> source; no personal tailnet hostname / token / origin committed to the repo. Plus standard
> open-source hygiene (LICENSE, a self-host README). This mostly aligns with choices already made
> (PAT entered at runtime, settings in IndexedDB).

### ✅ D5 — Product north star: chat-first agent UX (Phase 2/3)
*Confirmed.* tether should **feel like chatting with a coding agent** (à la Claude Code on iOS), not an
editor with an LLM side-panel. Phase 2/3 reframe: a conversation drives edits → diff review → commit;
the editor becomes the surface the agent acts on, not the centerpiece. Phase 0/1 plumbing is unchanged.
> Supersedes the PRD §7 "editor + explain-selection panel" framing for Phase 2/3; revisit the PRD when
> Phase 2 is designed. Does **not** affect Phase 1 (GitHub browse/open/edit/commit is needed regardless).

### ✅ D6 — App state: React Context store (no state library)
*Scaffold-time call (skeleton pre-authorized).* All app state lives in one `StoreProvider`
context (`src/state/`); views switch on a `view` field, no router. Avoids a dependency and
GitHub Pages sub-path routing.
> Rejected: Zustand (unneeded for one small store), react-router (a view switch suffices).

### ✅ D7 — Commit conflict model: user-resolved on 409 (Contents API)
*Confirmed for Phase 1.* Single-file commits use the Contents API with the held blob `sha`.
A stale `sha` returns 409; the app re-fetches the current remote file and makes the user
choose — **overwrite with my changes** (retry against fresh sha) or **discard & load latest**.
No silent auto-merge. Git Data API (atomic multi-file) stays Phase 3.

### ✅ D8 (was O2) — PAT storage: plain IndexedDB on-device
*Confirmed.* Token stored unencrypted in IndexedDB, held in memory only to build the
`Authorization` header, never logged/committed/displayed. Acceptable for a single-user,
on-device app. WebCrypto-wrapping remains a low-priority stretch.

### ✅ D9 (Phase 2) — Chat state in a dedicated `ChatProvider`, streaming isolated to the active bubble
*Confirmed during P2-T3.* Conversation state (`messages`, `agentStatus`, later `proposedEdit`)
lives in `src/chat/ChatProvider` mounted above the view switch, and per-token deltas go to a
tiny external store (`src/chat/streaming.ts`) that re-renders **only** the in-flight bubble via
`useSyncExternalStore`. Rationale: SPEC §3 forbids re-rendering the whole list per token, and the
global store's single `useMemo` would re-render every consumer on each update. Model/URL config
already bypass the store, so this keeps that boundary.
> Rejected: SPEC §5.5's "extend `src/state/store.ts`" for chat — it would jank streaming and bloat
> the store's 17-entry memo deps. The store still owns the `chat` View + chat-first landing (D5).

### ✅ D10 (Phase 2) — Model-agnostic agent tool-calling (`read_file`)
*Confirmed during P2-T4 after on-device probing.* The SPEC assumed `qwen2.5-coder` supports Ollama
tool-calling; it does **not** in this build — it prints the call as JSON in `content` (no structured
`tool_calls`). Two other pulled models differ: `qwen2.5:7b-instruct` emits native `tool_calls`;
`qwen3.5:9b` does too but is a *thinking* model that hides the final answer in `thinking`. So the
agent loop is robust to all three: honor native `tool_calls`, **else** deterministically parse a
leaked JSON `read_file` call from `content`, and always request `think:false` so answers stream into
`content`. Verified end-to-end (agent reads a file and uses it) across all three models.
> Rejected: relying solely on native tool-calling (breaks `qwen2.5-coder`); a pure text-only read
> protocol (native works for 2/3 and is the more standard path). `@`-attach remains the manual fallback.

### ✅ D11 (post-Phase-2 direction) — Pivot: tether becomes a thin client for agent *endpoints*
*Confirmed 2026-07-17* after the product review (`docs/feedback-2026-07-17-desktop-agent-direction.md`).
The north star shifts from "smart GitHub editor" to "thin mobile client for capable agent
endpoints" — local (Ollama) and cloud (OpenRouter, Anthropic API) now, and a **desktop agent**
(`fam-x` / Claude Code, with real shell/fs/web tools + the Claude subscription) later. **Sequenced
so nothing is wasted or prematurely deleted:**
> - **Phase 3 (`SPEC-phase3.md`) — foundation, reverses NO locked decision:** a `Provider`
>   abstraction behind the Ollama-only client, OpenRouter + Anthropic-API adapters, chat-page
>   model/endpoint selection, nav clarity. GitHub browse/edit/commit **stays functional.**
> - **Phase 4 — the desktop agent, gated on `fam-x` exposing a servable API** (today `fam` is a
>   terminal binary, not a server): this is where 🔒4 (no backend), 🔒3 (GitHub as source of truth),
>   🔒7 (Ollama-only transport), and the "no code execution / thin-client" non-goals get **reversed**,
>   and the GitHub editor/diff/commit code retires. **Those reversals are ratified here when Phase 4
>   is designed — not before.**
> - **Phase 3.5:** multi-chat (sessions layer on the Provider abstraction).
> Note: the Claude *subscription* is reachable only via Claude Code / Agent SDK as a desktop endpoint
> (Phase 4), never by scraping claude.ai; that is distinct from `fam`'s Anthropic **API-key** routing.

### ✅ D12 (Phase 3, P3-T1) — Provider abstraction behind the Ollama client
*Confirmed during P3-T1.* Generalized the Ollama-only `src/llm/client.ts` into a `Provider`
interface (`src/llm/providers/`): each endpoint is an adapter owning its wire format, stream
framing, and tool-call shape; the agent loop calls `provider.chat()` and stays format-blind.
Normalized `ChatMessage`/`ToolCall` carry parsed-object args and **no call id** — the loop pairs a
tool call with its result positionally, and adapters reconstruct wire ids (OpenAI `tool_call_id`,
Anthropic `tool_use_id`) from that ordering. Verified byte-for-byte vs Phase 2 against live Ollama
(native + leaked-JSON tool paths).
> Rejected: per-provider branches in the agent loop (leaks wire format upward); a normalized
> tool-call `id` field (unused by Ollama — deferred to the adapter that needs it, T3/T4).

### ✅ D13 (Phase 3, P3-T2) — Endpoint config store + spendable-key posture
*Confirmed during P3-T2.* Endpoints are `EndpointConfig` records (shape owned by the provider
layer, persisted by `src/storage/providers.ts` in IndexedDB) with an active `{endpoint, model}`
binding; `createProvider(config)` is the sole kind→adapter seam. Phase 2's `ollama_url`/
`ollama_model` migrate once into an endpoint (legacy keys left readable). Cloud **API keys are
spendable credentials** held on-device exactly like the PAT (D8): never logged, committed, or
displayed back — money at stake, not just repo scope, so removal is one tap. Acceptable for
single-user (§4.5).
> Rejected: EndpointConfig owned by the storage layer (the provider layer defines its own config
> shape; storage only persists it); any backend key vault (🔒4, single-user).

### ✅ D14 (Phase 3, P3-T7) — Sessions layer: concurrent chats on the Provider abstraction
*Confirmed during P3-T7.* Generalized the single-conversation `ChatProvider` into a `Session[]`
model: each session owns its messages, status, AbortController, `{endpoint, model}` binding, and
its OWN streaming channel (`streaming.ts` keyed by session id, not the D9 global singleton) — so
sessions on different endpoints stream concurrently while a per-token delta re-renders ONLY the
active bubble (§3 preserved). Sessions persist reload-safely in IndexedDB (in-flight placeholders
dropped, status reset). Same-Ollama-box concurrency is surfaced honestly with a **synchronous**
`queued` indicator; tether does not fight the GPU serialization (that's the user's
`OLLAMA_NUM_PARALLEL`).
> Rejected: one global streaming buffer (janks concurrent streams, breaks §3); OPFS for session
> data (IndexedDB is simpler for small structured JSON); client-side request serialization for the
> same box (Ollama's job, not the thin client's).

---

## 3. Decisions still genuinely open (flag before the phase that needs them)

| # | Decision | Needed by | Leaning |
|---|----------|-----------|---------|
| ❓ O1 | Ollama default model + params (e.g. `qwen2.5-coder:7b` vs `:14b`, context length) | Phase 2 | `qwen2.5-coder:7b` default on 12GB (14B is context-starved); **MUST be a runtime setting** (per D4), not hard-coded. |
| ❓ O3 | App icon / brand assets source | Phase 0 (manifest needs icons) | Placeholder generated icon set now; real assets later. |
| ❓ O4 | Custom domain for Pages vs default `*.github.io` | Phase 0 deploy | Default domain for MVP; custom domain is cosmetic. |
| ❓ O5 | Hosted multi-user service (others use shared hardware) | Deferred — post-MVP, only if pursued | If ever adopted: engine → vLLM/SGLang (batching), add auth, exposure beyond the tailnet (Funnel / real host), abuse + cost controls — and the single-user Non-goal gets revisited. D4's configurability keeps the door open; **do not build now.** |

These do not block Phase 0/1 implementation; resolve at the noted phase.
