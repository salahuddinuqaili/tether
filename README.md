<div align="center">

# tether

**Your iPhone, tethered to your desktop's GPU.**

A home-screen PWA that edits your GitHub repos and writes code with your desktop's
local LLM. The phone is a thin client; your desktop — Ollama on an RTX GPU, reached
over Tailscale — is the brain.

No backend. No App Store. No Mac in the build loop.

[![License: MIT](https://img.shields.io/badge/license-MIT-00FF66.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-Phase%203%20·%20multi--provider-00FF66.svg)
![PWA](https://img.shields.io/badge/PWA-installable-3b82f6.svg)
![Platform](https://img.shields.io/badge/platform-iOS%20Safari-lightgrey.svg)

</div>

---

## Why

Your desktop is always on, and the RTX GPU running Ollama codes with models
(Qwen2.5‑Coder‑class) far beyond anything a phone can. But the moment you leave the
desk, that capability is stranded. iOS editors (Working Copy, Textastic, Koder) give
you git and a text surface — none of them reach back into *your own* local inference.
And native iOS dev is gated behind a Mac you may not have.

**tether closes that gap:** a phone-sized window into your desktop's model and your
GitHub repos, built entirely in web tech so it ships without ever touching Xcode.

## How it works

```
  iPhone (PWA, installed to home screen)
  ┌──────────────────────────────────┐
  │  CodeMirror 6 editor             │
  │  GitHub client  ──── HTTPS ─────▶ api.github.com      (Contents / Git Data API)
  │  LLM client     ──── HTTPS ─────▶ Tailscale Serve ──▶ Ollama :11434  (your desktop)
  │  OPFS + IndexedDB (on-device cache)
  │  Service worker + manifest       │
  └──────────────────────────────────┘
```

- **Editing** happens on the phone (CodeMirror 6).
- **Inference** happens on *your* desktop (Ollama over Tailscale). The phone never runs a model.
- **Source of truth** is GitHub. The phone cache is disposable, never canonical.
- **No server of your own** — the browser talks directly to GitHub and to your Ollama.

Everything personal — your GitHub token, your Ollama URL, your model — is a **runtime
setting entered in the app**, never baked into source. Bring your own repos and your
own GPU.

## Status & roadmap

tether ships in phases, each with a hard stop signal. It's early — here's exactly where things stand:

| Phase | Delivers | State |
|------|----------|-------|
| **0 · Skeleton** | Installable PWA + offline shell + CodeMirror editor on a local buffer | ✅ Done |
| **1 · GitHub** | PAT auth, browse a repo, open/edit/commit a file from the phone | ✅ Done |
| **2 · Chat-first agent** | Streaming chat with your desktop model, `read_file` tool loop, diff-before-commit, apply → commit | ✅ Done |
| **3 · Multi-provider thin client** | One `Provider` abstraction over local Ollama **and** cloud (OpenRouter, Anthropic API); pick provider+model on the chat page; concurrent multi-chat; labeled bottom-tab nav | 🟡 **In review** |

> **Direction ([D11](DECISIONS.md)):** tether is pivoting from "smart GitHub editor" to a **thin
> client for capable agent endpoints** — local and cloud now, a desktop agent (fam-x / Claude Code)
> next. Phase 3 lays that foundation without reversing any locked decision; GitHub browse/edit/commit
> stays fully functional. See [`SPEC-phase3.md`](SPEC-phase3.md), [`PRD.md`](PRD.md),
> [`DECISIONS.md`](DECISIONS.md), and [`docs/`](docs/) for the plan and rationale.

## Tech

Vite · React · TypeScript · Tailwind (dark-first, `#00FF66` accent) · CodeMirror 6 ·
`vite-plugin-pwa` (manifest + Workbox service worker) · deployed as static files to
GitHub Pages. No backend, no database.

## Run it locally

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + static build to dist/
npm run preview    # serve the production build
```

Placeholder app icons are generated dependency-free by `python3 scripts/gen-icons.py`.

## Self-host your own instance

tether is **single-user per instance** by design — you run your own copy. Nothing
personal is committed; you supply everything at runtime.

**1. Deploy the static app.** Fork this repo and push to `main` — the
[Pages workflow](.github/workflows/deploy.yml) builds and deploys automatically. One-time
setup: **Settings → Pages → Source: "GitHub Actions"**. It serves at
`https://<you>.github.io/<repo>/`. The only build-time knob is the base path:

- **`BASE_PATH`** — `/<your-repo>/` for a project site, or `/` for a custom domain
  (see [`.env.example`](.env.example)).

> GitHub Pages on a **free** plan requires a **public** repo. To keep it private, use
> GitHub Pro or a host like Cloudflare Pages.

**2. Expose your desktop model (Phase 2).** On your desktop, run Ollama reachable on
your tailnet and put HTTPS in front of it — a PWA served over HTTPS cannot call a plain
`http://` endpoint:

```bash
# Ollama, reachable on the tailnet with the PWA's origin allowed through CORS
OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS="https://<you>.github.io" ollama serve

# Tailscale Serve — real TLS cert on your *.ts.net domain, terminating to Ollama
tailscale serve https / http://localhost:11434
```

Scope Ollama to your own devices with Tailscale ACLs. Full spike notes:
[`docs/spikes-phase2.md`](docs/spikes-phase2.md).

**3. Bring a GitHub token (Phase 1).** Create a **fine-grained PAT** with
**contents read/write** on just the repos you want, short expiry. You paste it into the
app; it lives in on-device IndexedDB and never leaves the phone.

## What tether is *not*

Deliberate non-goals — these keep the project small and the surface honest:

- ❌ A native iOS app / App Store distribution
- ❌ An on-device LLM (the whole point is your desktop's GPU)
- ❌ A terminal or code execution on the phone
- ❌ Multi-user, accounts, or real-time collaboration
- ❌ Per-language tooling beyond what CodeMirror gives for free

## Contributing

Early-stage and moving through the phased plan above. If you'd like to help: open an
issue to discuss before a PR, keep changes within the current phase, and read
[`DECISIONS.md`](DECISIONS.md) first — it records what's locked and *why*, so you can
tell an open question from a settled one.

## License

[MIT](LICENSE) © 2026 Salahuddin
