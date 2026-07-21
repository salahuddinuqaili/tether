# tether — notes for Claude Code sessions

## 👉 Read first
**[`docs/review-phase3-findings.md`](docs/review-phase3-findings.md)** — open issues from the
post-Phase-3 review, ranked with `file:line` and fixes. It has **two must-fix items** (a
session-load crash path and a leaked tailnet hostname) and the Phase 4 gotchas. Skim it before
new work.

## Orientation
- **Spec-driven.** The "what" and "why" live in `PRD.md`, `SPEC-phase3.md`, `SPEC-phase4.md`,
  `ROADMAP.md`, and `DECISIONS.md`. Treat **`DECISIONS.md` as the source of truth** for locked
  vs. open calls — including the D11–D15 pivot (tether → thin client for agent *endpoints*; a
  desktop agent grows real tools in Phase 4).
- **Shape:** a static PWA, no backend. The phone talks directly to provider endpoints
  (Ollama / OpenAI-compat / Anthropic, behind `src/llm/providers/`) and to GitHub via a
  fine-grained PAT. Multi-chat sessions live in `src/chat/`.

## Build / check
- `npm run build` — `tsc --noEmit` + `vite build`; enforced in CI (`.github/workflows/deploy.yml`).
- `npm run typecheck` — fast type gate.
- `scripts/smoke-*.ts` import the **real** source and exercise the risky paths (provider loop,
  session isolation, storage). Run manually — they need a live model / preview / API keys and are
  **not** in CI.

## Conventions
- **Nothing personal in source or docs** (D4): no PATs, API keys, or real tailnet hostnames —
  use `your-machine.your-tailnet.ts.net`-style placeholders. Everything personal is runtime
  config in IndexedDB.
- Keep the public repo **agent- and transport-agnostic** (SPEC-phase4 §"scope"): the actual
  desktop agent and any bridge are the self-hoster's private setup, never committed here.
