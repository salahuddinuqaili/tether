# SPEC — Phase 4: Desktop agent — talk to any agent endpoint (the D11 end-state)

> Status: Draft for implementation, written after Phase 3 (multi-provider, PR #8) and the
> 2026-07-18 direction interview. This is the phase D11 always pointed at: tether becomes a
> thin client for a **desktop agent** — an endpoint with real hands (shell / filesystem / web)
> that runs its own tools. It **ratifies the locked-decision reversals** D11 deferred. Branch
> `feat/phase-4-agent` off `feat/phase-3-providers` (Phase 3 merges first). Implement in a
> **fresh session** — this SPEC is the handoff.
>
> **Scope note — this repo stays agent-agnostic.** Which agent you point tether at, and any
> transport bridge you run to reach it, are the **self-hoster's private setup** — never part of
> the public repo. This SPEC describes only the generic client + protocol.

## 1. Goal & stop signal

Make tether talk to a **desktop agent**: an LLM endpoint that **runs its own tools server-side**
(shell, filesystem, web) rather than a bare model tether spoon-feeds `read_file` to. tether stays
a **thin, generic client** — it speaks **one HTTP/SSE agent-endpoint protocol** and never knows
*which* agent it's talking to. Which agent that is — and how it's made reachable — is
**desktop-side config, not tether code**. GitHub browse/edit/commit **stays**, demoted to one
capability among several.

**Stop signal:** from the phone, chat with your **desktop agent** — send a request, watch it
**run tools and stream the result back**, and it's obvious this is *your desktop's agent*, not
just a model. And GitHub browse/edit still works from the same app.

## 2. Direction context — the D11 end-state, ratified

Phase 3 proved "tether talks to arbitrary browser-callable endpoints" behind the `Provider`
abstraction (D12). Phase 4 spends that foundation on the real prize: **the desktop grows hands.**
The phone stays thin; the brain upgrades from a *model* to an *agent*. Reversals ratified here
(see **DECISIONS D15**):

- **🔒4 (no backend) → a desktop daemon runs** — the agent (or a small bridge in front of it),
  **on the user's own desktop, over Tailscale**. Still **no hosted / multi-tenant backend** —
  🔒4's single-user spirit holds; only "the phone talks to nothing but GitHub + a model" changes.
- **"No code execution" / "thin client is an editor" non-goals → reversed** — the desktop agent
  executes code by design. The *phone* is still thin; it just points at something with hands.
- **🔒7 (Ollama-only transport)** — already generalized in Phase 3.
- **🔒3 (GitHub as source of truth) → softened, NOT dropped** — GitHub becomes one capability;
  **editing stays**. The editor/diff/commit code is **kept**, not retired.

**Kept generic (the hard requirement):** the public tether repo carries **no agent-specific and no
transport-specific code**. tether only ever speaks the generic agent-endpoint protocol (§5). Making
a real agent reachable at such an endpoint is desktop-side (§6) — the same discipline as "no tailnet
hostname in source" (D4).

## 3. Two tracks

Phase 4 spans two artifacts, deliberately separated:

- **Track A — tether (public, generic).** A new **agent-endpoint** kind behind the D12 `Provider`
  seam + the agent-conversation UI + GitHub demotion + the D15 reversals. Small, because Phase 3
  already did the heavy lifting.
- **Track B — a desktop adapter (private, self-hoster's).** Whatever it takes to expose *your*
  agent at the generic endpoint. An agent that already speaks HTTP/SSE needs nothing. An agent that
  lives on another transport (a chat protocol, a CLI, an RPC) needs a **small desktop bridge** that
  translates it to the endpoint shape. **This is a separate, private artifact — never in the public
  repo**, and it drops in with **zero tether changes.**

## 4. Spike gate — validate reachability FIRST (mirror Phases 2 & 3)

Before any agent UI, prove your reference agent is reachable end-to-end from the phone. Record the
generic results in `docs/spikes-phase4.md`; keep any agent/transport specifics in your private notes.

- **S-P4-1 ❗ — the agent is reachable at an HTTP/SSE endpoint.** Either the agent already serves
  HTTP/SSE, or a small desktop bridge exposes it there. **Pass:** a request in, a reply out.
  **Fail → rethink the transport** (a different bridge, or have the agent expose HTTP directly).
- **S-P4-2 ❗ — reachable from the PWA origin.** The endpoint is fronted by **Tailscale Serve TLS**,
  and the installed PWA (github.io origin) reaches it — **CORS + valid cert**, exactly the Phase 2/3
  gate. **Fail → fix:** same Serve/CORS levers as before.
- **S-P4-3 — an agent turn streams end-to-end.** tether sends a prompt and the reply **streams**
  back, including the agent narrating a tool it ran. **Pass:** the stop-signal loop is real.

**Build agent UI only once S-P4-1/2 pass.**

## 5. The generic agent-endpoint protocol (Track A keystone)

Keep it dead simple and **reuse Phase 3's OpenAI-compat adapter**:

- **Wire:** HTTP `POST /chat/completions`, **SSE**, OpenAI-compatible — so tether's existing
  `providers/openai.ts` parses it with little/no change. Any agent (or a bridge in front of one) can
  emit this.
- **The agent owns its tools.** For an agent endpoint tether sends **no `tools`** and runs **no
  client-side `read_file` loop** (contrast Phase 2 / D10). It streams the agent's response and the
  agent narrates its own tool use.
- **Tool activity, v1 = narration.** The agent describes what it's doing in the streamed content
  ("Running `pytest`… reading `app.py`…"). tether renders it (markdown/code blocks). A **structured
  tool-activity SSE extension** (distinct activity chips, destructive-action confirms) is a **later
  enhancement**, not v1.
- **Config:** `EndpointConfig` gains **`kind: 'agent'`** (or an `agentManaged: boolean` flag on an
  openai endpoint). `createProvider` routes it to the openai adapter with the "no tools / no loop"
  behavior. Auth = per-endpoint token + Tailscale ACL, like Ollama.

> Net Track-A change is **small**: a new endpoint kind + a one-branch skip of the client-side tool
> loop + UI polish. This is the payoff of the D12 abstraction.

## 6. Desktop reachability (Track B — private, self-hoster's)

Not tether code. Whatever exposes your agent at the §5 endpoint over Tailscale Serve:

- If the agent already serves **HTTP/SSE (OpenAI-compatible)**, point tether at it — done.
- If the agent lives on **another transport** (a chat/bot protocol, a CLI, an RPC), run a **small
  desktop bridge** that relays to/from it and serves the §5 endpoint. Prefer a transport path that
  doesn't collide with the agent's own connections.
- **⚠ Security & privacy:** a bridge may authenticate as *you* on some third-party service and touch
  your data. Run it **on your desktop only, over your tailnet**; treat its session/credentials like
  secrets; scope it narrowly. This is a real trust boundary — decide it deliberately.
- **Packaging:** its own private repo or a fenced, **git-ignored** dir — never bundled into the PWA,
  never in the public repo.

## 7. Track-A tasks (tether, public)

Each with an acceptance check; sized for single sittings.

- **P4-T1 — Agent endpoint kind.** `EndpointConfig` `kind: 'agent'` (OpenAI-compat baseUrl +
  token/key); `createProvider` builds the openai adapter in **agent mode** (no `tools`). Settings +
  chat picker offer it. **Acceptance:** configure an agent endpoint and select it.
- **P4-T2 — Agent turn (no client loop).** The agent turn skips `READ_FILE_TOOL` + the read_file
  loop for agent endpoints — single-pass streaming of the agent's narrated response. **Acceptance:**
  a turn against an agent endpoint streams the reply with no client-side tool round; Ollama/OpenRouter
  turns are unchanged.
- **P4-T3 — Agent conversation UI.** Render narrated tool activity nicely (markdown, code blocks,
  maybe a subtle "agent" badge / collapsible narration); status reads "working…" not "reading
  files…". **Acceptance:** on-device, an agent turn reads clearly as an agent doing work.
- **P4-T4 — GitHub demotion.** Chat/agent is the primary surface; GitHub browse/edit/commit stays
  reachable (a Browse tab) but is no longer the framing. **Acceptance:** the app reads as "talk to
  your desktop agent," and GitHub editing still works end-to-end.
- **P4-T5 — DECISIONS D15 + docs.** Ratify the reversals; note the public/private boundary.
- **Stop signal** at S-P4-3 + P4-T3 (chat with your agent, watch it work) with GitHub still functional.

## 8. Non-goals (Phase 4)

- **No agent-specific or transport-specific code in public tether** — it stays generic (the point).
- **No hosted backend** — the agent/bridge is *your desktop*, over Tailscale (🔒4 single-user holds).
- **No structured tool-activity protocol v1** — narration suffices; the rich activity UI is later.
- **Not retiring GitHub** — editing stays; 🔒3 is softened, not dropped.

## 9. Risks

- **Reachability + transport** (S-P4-1/2) — the make-or-break; a bridge for a non-HTTP agent is a
  real trust boundary (§6).
- **Reply granularity** — a bridged agent may reply in whole messages, not token deltas; the bridge
  normalizes that into SSE, and streaming may be chunkier than a raw model.
- **Bridge scope creep** — keep any bridge a thin relay; it is not a second product.
