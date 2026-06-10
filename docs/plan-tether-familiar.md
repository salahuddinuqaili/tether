# Joint build plan — tether × familiar

> Status: adopted 2026-06-10. Covers how `tether` (this repo) and `familiar` (the
> LLM-agnostic coding-agent harness, separate repo) are built and sequenced together,
> how both ship as open source while remaining daily-driver personal tools, and how
> their one area of overlap is resolved.

## The two products, in one line each

- **tether** — a home-screen PWA code editor for iPhone: browse / edit / commit GitHub
  repos from the phone, with optional LLM assistance from the desktop's local model
  (Ollama over Tailscale). Works with the desktop **off** for all git editing.
- **familiar** — a terminal agent harness (`fam`): an agentic loop with file / search /
  shell tools, a pluggable provider layer (local Ollama and frontier APIs as
  interchangeable engines), a persistent reviewed knowledge layer ("the brain"), a
  workspace-contract system that machine-enforces a repo's house rules, and an eval
  harness. Runs on the desktop; phone access arrives later via `fam serve` on the tailnet.

They serve different needs: tether is the **hand-editing surface** (you type, the model
assists), familiar is the **delegation surface** (the agent works, you approve). Same
tailnet, same GPU, different interaction models.

## The workspace data artifact

The contract-bound plain-text workspace that familiar tends (append-only journal paths,
merge gates, path-scoped model policy, banned commands) will be an **open-source
workspace repo of its own** — the data-storage artifact for the system. Which repo that
is gets configured at runtime (in tether's settings and familiar's config) before work
begins against it; the name/location is **never hardcoded** in either codebase, per
tether DECISIONS D4 and familiar's code-vs-data split. Contract tests in familiar run
against a synthetic fixture replica of that workspace, never a live instance.

## OSS posture (both repos)

Both projects are open source **and** personal daily drivers. The rule that makes this
safe, already locked in both PRDs: **the product is code; everything personal is data
outside the repo.** tether keeps PAT / Ollama URL / model as runtime settings entered in
the app (DECISIONS D4); familiar keeps config in `~/.config/familiar/`, the brain in its
own private repo, and the live workspace instance separate from its public template.

Guardrails added by this plan:

1. **familiar:** dogfooding artifacts never cross into the public repo. Example sessions
   in docs, eval transcripts, and test fixtures must be synthetic — real ones carry brain
   and workspace content. Publish the eval *matrix* (pass/fail, turns, cost), never raw
   transcripts. Add a pre-commit / CI scan for secrets, tailnet hostnames, and private
   local paths, so this is mechanical rather than disciplined.
2. **tether:** document the GitHub Pages shared-origin caveat for self-hosters — every
   project site on the same `<user>.github.io` origin shares IndexedDB/OPFS, so anything
   else hosted there could read the stored PAT. Disclose in the README; mitigations are a
   custom domain or WebCrypto-wrapping the token (DECISIONS O2).
3. **Both:** personal instance config (Pages URL, tailnet name, model choice, workspace
   repo name) stays out of committed examples — `.env.example` / `config.example.toml`
   only.

## Build sequence (interleaved)

1. **Close tether Phase 0 now.** Enable Pages (Settings → Pages → Source: "GitHub
   Actions"), run the deploy (`deploy.yml` has `workflow_dispatch`; it has never run),
   confirm the live URL, install on the real iPhone, write the P0-T7 mobile-UX note.
   Under an hour; everything else hangs off a live HTTPS URL.
2. **Build tether Phase 1 to its stop signal** — the mobile git editor
   (`docs/tasks-phase0-1.md` P1-T1…T9). This is tether's durable, non-overlapping value:
   desktop-independent, zero dependency on familiar, a complete shippable OSS product on
   its own. Before P1-T2: add ESLint + a test runner (the GitHub client's base64 and
   `sha`-conflict logic warrant unit tests). Before P1-T1: resolve DECISIONS O2 with the
   shared-origin issue in mind.
3. **Run the Tailscale Serve + Ollama spike once, early, as its own task** — not inside
   either project's UI work. A throwaway HTTPS page calling `https://<host>.ts.net`
   Ollama from iOS Safari validates the linchpin both tether Phase 2 *and* familiar's
   `fam serve` depend on (`docs/spikes-phase2.md`). If it fails, know it before writing
   either frontend. Record the result in both repos; until it lands, familiar's PRD
   should say tether is *designed around* this pattern, not that it proved it.
4. **Start familiar Phases 1–2** (walking skeleton, then agnostic core). Longest pole,
   portfolio centerpiece, and its two-weekend Rust kill-switch can only be evaluated by
   starting. No design-attention conflict with step 2: one is fetch-edit-commit plumbing,
   the other is the agent loop.
5. **Resolve the overlap deliberately:** tether gets a *minimal* Phase 2 — the read-only
   "explain selection / ask about code" panel — and **tether Phase 3 (apply-LLM-edits
   loop) is deferred indefinitely** in favor of familiar's `fam serve` owning agentic
   editing from the phone. Record in DECISIONS.md as a scope cut with rationale
   ("agentic mobile editing delegated to familiar"). This kills the build-it-twice
   problem and strengthens both stories.
6. **familiar Phases 3–4** (brain, workspace contracts, evals, serve) as specced — the
   moat lives there; protect that time by keeping steps 1–3 strictly time-boxed.

## Why this order

- tether reaches "done, usable, shippable OSS" at the end of step 2 instead of being a
  perpetually half-built three-phase project.
- The riskiest shared assumption (Serve TLS / CORS / mixed content on iOS) is validated
  once, early, for both projects.
- familiar inherits a proven TLS answer and a real second frontend consumer (the phone)
  before `fam serve` is written.
- The repos referencing each other's decisions — tether's DECISIONS noting the Phase 3
  cut, familiar's PRD citing the shared spike result honestly — is itself portfolio
  material: architecture across a portfolio, not just within a project.
