# tether — Product Requirements Document

> **Status:** Draft v0.1 — seed for planning
> **Owner:** Salahuddin
> **One-liner:** A home-screen PWA code editor for iPhone that edits your GitHub repos and writes code with your *desktop's* local LLM — the phone is a thin client, your RTX rig is the brain.

-----

## 1. Problem & motivation

You are desktop-bound by choice: the RTX 5070 + Ollama is always on, and it runs coding models (Qwen2.5-Coder 7B/14B-class) far beyond anything a phone can. But the moment you leave the desk, that capability is stranded. Existing iOS editors (Working Copy, Textastic, Koder) give you git and a text surface, but none of them reach back into *your own* local inference. And native iOS development is gated behind a Mac you don't have.

`tether` closes that gap: a phone-sized window into your desktop's model and your GitHub repos, built entirely in web tech so it ships without ever touching Xcode.

## 2. Core concept (LOCKED)

A **Progressive Web App**, installed to the iPhone home screen, that is a **thin client**:

- **Editing** happens on the phone (CodeMirror 6).
- **Inference** happens on the desktop (Ollama over Tailscale). The phone never runs a model.
- **Source of truth** is GitHub. The phone is a cache, never the canonical store.

No backend of your own. No App Store. No Mac in the build loop. This mirrors the Neon Protocol "no backend" pattern.

## 3. Goals / Non-goals

### Goals

- Install to iPhone home screen, launch standalone (no Safari chrome).
- Browse a GitHub repo, open a file, edit it, commit it back — from the phone.
- Select code, ask the desktop model about it, stream the answer back, and apply LLM edits into the buffer.
- Work over Tailscale from anywhere the phone has a network, as long as the desktop is awake.

### Non-goals (explicit — do NOT build these)

- ❌ Native iOS app / App Store / notarized distribution.
- ❌ On-device LLM (deferred to a possible future "offline mode" — see §10).
- ❌ Running / executing code on the phone (no terminal, no shell, no sandbox).
- ❌ Multi-user, accounts, collaboration, real-time co-editing.
- ❌ Supporting every language's tooling. Lean on what CodeMirror gives for free.

## 4. Users & primary scenario

Single user: you. Primary scenario — away from the desk (couch, transit, travel), you open a repo in `tether`, make an LLM-assisted change using your desktop's model, review the diff, and commit. The desktop is never touched directly.

## 5. Architecture

```
  iPhone (PWA, home screen)
  ┌─────────────────────────────┐
  │  CodeMirror 6 editor         │
  │  GitHub client  ── HTTPS ──▶ api.github.com   (Contents / Git Data API)
  │  LLM client     ── HTTPS ──▶ Tailscale Serve ─▶ Ollama :11434 (desktop, RTX 5070)
  │  OPFS / IndexedDB (cache)    │
  │  Service worker + manifest   │
  └─────────────────────────────┘
```

### Components

1. **Editor surface** — CodeMirror 6. Chosen over Monaco for touch ergonomics, modularity, and bundle size; Monaco is desktop-first and heavy.
2. **GitHub client** — REST API via a fine-grained PAT. Contents API for single-file commits (MVP); Git Data API (blob→tree→commit→ref) for atomic multi-file commits later. GitHub API supports CORS, so the browser can call it directly.
3. **LLM client** — calls Ollama's `/api/chat` (streaming) on the desktop, reached via Tailscale MagicDNS.
4. **Local persistence** — OPFS (Origin Private File System) for file buffers; IndexedDB for settings + token. iOS Safari supports both.
5. **PWA shell** — Web App Manifest (standalone display) + service worker (offline app shell, asset caching).

### Critical infra decisions (resolve in Phase 2 — these are the real risks)

- **Mixed content:** an HTTPS PWA calling an `http://` Ollama endpoint is blocked by the browser. **Solution: Tailscale Serve** puts valid TLS in front of the Ollama port on the `*.ts.net` domain, giving an `https://` endpoint with a real cert. This is the linchpin — validate it early.
- **Ollama host binding:** Ollama binds to localhost by default. Set `OLLAMA_HOST=0.0.0.0` so it's reachable on the tailnet.
- **CORS on Ollama:** set `OLLAMA_ORIGINS` to allow the PWA's origin, or requests are blocked.
- **Tailscale ACLs:** restrict the Ollama port to your own devices only.

## 6. Tech stack (LOCKED)

- **Framework:** Next.js 14 (static export) or Vite + React — agent to recommend; bias to whichever gives the cleanest PWA + static-host story.
- **Editor:** CodeMirror 6.
- **Styling:** Tailwind; dark-first, "Kinetic Darkroom"-adjacent palette (primary accent ~#00FF66) to stay in family with Pulse.
- **Hosting:** static host (GitHub Pages / Vercel / Cloudflare Pages) — must serve over HTTPS for PWA install.
- **Networking:** Tailscale (desktop + phone on one tailnet, Serve for TLS).
- **No backend, no database.**

## 7. Phased plan (MVP-first, with stop signals)

> Each phase ends at a hard stop signal. Do not start the next phase until the current stop signal is met. Reassess scope at each stop.

### Phase 0 — Skeleton

Build: PWA scaffold, manifest, service worker, installable to home screen; CodeMirror renders and edits a local buffer. No GitHub, no LLM.
**Stop signal:** installs to the iPhone home screen, launches standalone, and you can type into a syntax-highlighted buffer.

### Phase 1 — GitHub (delivers the "update GitHub" requirement)

Build: fine-grained PAT entry + secure local storage; browse repo tree; open a file; edit; commit a single file via the Contents API.
**Stop signal:** pull a file from a real repo, edit it on the phone, and watch the commit land on GitHub. *This is a usable mobile git editor on its own, with zero LLM.*

### Phase 2 — Local LLM (delivers the "local LLM" requirement)

Build: Tailscale Serve TLS in front of Ollama; LLM client with streaming; a chat/answer panel; "explain selection" action. Resolve all §5 infra risks here.
**Stop signal:** select code on the phone, ask the desktop model, and get a streamed response back through `tether`.

### Phase 3 — Full loop & polish

Build: apply LLM-suggested edits directly into the buffer; diff view before commit; multi-file atomic commits via Git Data API; styling pass.
**Stop signal:** LLM proposes an edit → you apply it → review diff → commit, entirely from the phone.

**MVP = Phase 0 + Phase 1.** Phase 2 realizes the actual vision. Phase 3 is refinement.

## 8. Security

- Fine-grained PAT, scoped to specific repos, **contents read/write only**; consider short expiry.
- Token entered at runtime, stored in IndexedDB/OPFS on-device; never committed to the repo.
- Tailscale ACLs limit Ollama reachability to your devices.
- Treat the phone cache as disposable; GitHub is the source of truth.

## 9. Risks & mitigations

|Risk                                               |Mitigation                                                                  |
|---------------------------------------------------|----------------------------------------------------------------------------|
|Mixed content (HTTPS PWA → HTTP Ollama)            |Tailscale Serve TLS — validate in Phase 2 spike *before* building the LLM UI|
|iOS Safari PWA storage eviction (~7-day inactivity)|GitHub is source of truth; OPFS is cache only                               |
|CodeMirror touch ergonomics on a phone keyboard    |UX spike in Phase 0; test on the actual 14 Pro Max early                    |
|Desktop offline → LLM features dead                |Graceful degradation: editor + git work without the model                   |
|PAT leakage                                        |Scoped fine-grained token, on-device only, expiry                           |

## 10. Deferred / future

- **Offline mode:** on-device quantized ~3B model (Qwen2.5-Coder 3B) via WebLLM/WebGPU when iOS Safari support firms up. Weak for coding; explicitly a fallback, not the headline.
- **EU alternative distribution:** if you ever want a "real app," the DMA path (notarized web distribution / alt marketplace) exists for EU users — but it still needs a macOS build toolchain, so PWA stays the right call for now.

## 11. Success criteria

From the phone, away from your desk: open one of your repos, make an LLM-assisted edit using your desktop's model, review it, and commit — without touching the desktop.

-----

## Appendix A — Claude Code planning kickoff prompt

> Paste this into a fresh Claude Code session in the `tether` repo, with this PRD present as `PRD.md`, to run the **planning** pass (not the build).

```
You are planning the `tether` project. Read PRD.md in full before doing anything.

Your job in this session is to PLAN, not to write feature code. Produce:

1. A DECISIONS.md capturing every locked architecture choice from the PRD,
   plus the open decisions you need me to confirm (framework choice, host,
   CodeMirror extension set). For each open decision, give your recommendation
   and a one-line rationale.

2. A spike list for Phase 2's infra risks (Tailscale Serve TLS in front of
   Ollama, OLLAMA_HOST/OLLAMA_ORIGINS, CORS, mixed content). These must be
   validated before any LLM UI is built — call out which spike, if it fails,
   would force an architecture change.

3. A task breakdown for Phase 0 and Phase 1 ONLY, sized for single sittings,
   each task with its acceptance check. Do not break down Phase 2/3 yet.

4. The repo skeleton you propose (file/folder tree) with a one-line purpose
   per top-level entry.

Constraints: no backend, no database, PWA only, no native iOS, no on-device
LLM. Respect every Non-goal in the PRD. Ask me clarifying questions before
finalizing if anything is ambiguous. Stop after planning — do not scaffold
code until I confirm.
```
