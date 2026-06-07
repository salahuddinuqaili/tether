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

---

## 3. Decisions still genuinely open (flag before the phase that needs them)

| # | Decision | Needed by | Leaning |
|---|----------|-----------|---------|
| ❓ O1 | Ollama default model + params (e.g. `qwen2.5-coder:7b` vs `:14b`, context length) | Phase 2 | `qwen2.5-coder:7b` default on 12GB (14B is context-starved); **MUST be a runtime setting** (per D4), not hard-coded. |
| ❓ O2 | PAT storage hardening (plain IndexedDB vs WebCrypto-wrapped) | Phase 1 | Start plain in IndexedDB (on-device, single-user); note WebCrypto wrap as a Phase 1 stretch. |
| ❓ O3 | App icon / brand assets source | Phase 0 (manifest needs icons) | Placeholder generated icon set now; real assets later. |
| ❓ O4 | Custom domain for Pages vs default `*.github.io` | Phase 0 deploy | Default domain for MVP; custom domain is cosmetic. |
| ❓ O5 | Hosted multi-user service (others use shared hardware) | Deferred — post-MVP, only if pursued | If ever adopted: engine → vLLM/SGLang (batching), add auth, exposure beyond the tailnet (Funnel / real host), abuse + cost controls — and the single-user Non-goal gets revisited. D4's configurability keeps the door open; **do not build now.** |

These do not block Phase 0/1 implementation; resolve at the noted phase.
