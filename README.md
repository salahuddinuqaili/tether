# tether

A home-screen **PWA code editor for iPhone** that edits your GitHub repos and writes code
with your **desktop's local LLM**. The phone is a thin client; your desktop (Ollama on an
RTX GPU, reached over Tailscale) is the brain. No backend, no App Store, no Mac in the build loop.

> **Status: Phase 0 (skeleton).** Installable PWA + a working CodeMirror editor on a local
> buffer. GitHub sync (Phase 1) and the local-LLM loop (Phase 2) are planned, not yet built —
> see [`PRD.md`](PRD.md), [`DECISIONS.md`](DECISIONS.md), and [`docs/`](docs/).

## Tech

Vite + React + TypeScript · Tailwind v4 · CodeMirror 6 · `vite-plugin-pwa` (manifest + service
worker) · deployed static to GitHub Pages.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + static build to dist/
npm run preview    # serve the production build locally
```

Placeholder app icons are generated (no deps) by `python3 scripts/gen-icons.py`.

## Deploy (GitHub Pages)

Pushing to `main` builds and deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
One-time setup: repo **Settings → Pages → Source: "GitHub Actions"**. The site is served at
`https://<user>.github.io/<repo>/`.

## Self-hosting (per DECISIONS D4)

tether is open source and **single-user per instance** — run your own copy. Nothing personal is
committed: your GitHub token, Ollama URL, and model are all **runtime settings entered in the app**
(Phases 1–2), never baked into source. The only build-time knob is the base path:

- **`BASE_PATH`** — set to `/<your-repo>/` for a project site, or `/` for a custom domain
  (see [`.env.example`](.env.example)).

When the LLM loop lands, you'll also run, on your desktop: Ollama (`OLLAMA_HOST=0.0.0.0`,
`OLLAMA_ORIGINS=<your Pages origin>`) behind Tailscale Serve for HTTPS, plus a fine-grained
GitHub PAT (contents read/write, scoped repos). See [`docs/spikes-phase2.md`](docs/spikes-phase2.md).

## License

MIT — see [`LICENSE`](LICENSE).
