# SPEC — Phase 4: Desktop agent — talk to any agent endpoint (the D11 end-state)

> Status: Draft for implementation, written after Phase 3 (multi-provider, PR #8) and the
> 2026-07-18 direction interview. This is the phase D11 always pointed at: tether becomes a
> thin client for a **desktop agent** — an endpoint with real hands (shell / filesystem / web)
> that runs its own tools. It **ratifies the locked-decision reversals** D11 deferred. Branch
> `feat/phase-4-agent` off `feat/phase-3-providers` (Phase 3 merges first). Implement in a
> **fresh session** — this SPEC is the handoff.

## 1. Goal & stop signal

Make tether talk to a **desktop agent**: an LLM endpoint that **runs its own tools server-side**
(shell, filesystem, web) rather than a bare model tether spoon-feeds `read_file` to. tether stays
a **thin, generic client** — it speaks **one HTTP/SSE agent-endpoint protocol** and never knows
*which* agent it's talking to. Which agent that is — `fam-x`, `hermes`, Claude Code — is
**desktop-side config, not tether code** (the "any agent" requirement). GitHub browse/edit/commit
**stays**, demoted to one capability among several.

**Stop signal:** from the phone, chat with your **desktop agent** — reference target **hermes**,
reached through a **desktop Telegram↔HTTP bridge** — send a request, watch it **run tools and
stream the result back**, and it's obvious this is *your desktop's agent*, not just a model. And
GitHub browse/edit still works from the same app.

## 2. Direction context — the D11 end-state, ratified

Phase 3 proved "tether talks to arbitrary browser-callable endpoints" (Ollama, OpenRouter,
Anthropic) behind the `Provider` abstraction (D12). Phase 4 spends that foundation on the real
prize: **the desktop grows hands.** The phone stays thin; the brain upgrades from a *model* to an
*agent*. Reversals ratified here (see **DECISIONS D15**):

- **🔒4 (no backend) → a desktop daemon runs** — the agent (fam-x) or a bridge, **on the user's
  own desktop, over Tailscale**. Still **no hosted / multi-tenant backend** — 🔒4's single-user
  spirit holds; only "the phone talks to nothing but GitHub + a model" changes.
- **"No code execution" / "thin client is an editor" non-goals → reversed** — the desktop agent
  executes code by design. The *phone* is still thin; it just points at something with hands.
- **🔒7 (Ollama-only transport)** — already generalized in Phase 3.
- **🔒3 (GitHub as source of truth) → softened, NOT dropped** — GitHub becomes one capability;
  **editing stays** (interview call). The editor/diff/commit code is **kept**, not retired.

**Kept generic (the hard requirement):** the public tether repo carries **no fam-x, no hermes, no
Telegram code**. tether only ever speaks the generic agent-endpoint protocol (§5). Making a real
agent reachable at such an endpoint is desktop-side (§6) — the same discipline as "no tailnet
hostname in source" (D4).

## 3. Two tracks

Phase 4 spans two artifacts, deliberately separated:

- **Track A — tether (public, generic).** A new **agent-endpoint** kind behind the D12 `Provider`
  seam + the agent-conversation UI + GitHub demotion + the D15 reversals. Small, because Phase 3
  already did the heavy lifting.
- **Track B — the desktop bridge (private reference).** A **Telegram↔HTTP/SSE bridge** that exposes
  **hermes** as the generic endpoint — the thing we build + test against *now*. A **separate
  artifact** (own repo or a clearly-fenced `bridge/` dir, never bundled into the PWA). `fam-x`'s
  own HTTP server is the same endpoint shape, later — it drops in with **zero tether changes.**

## 4. Spike gate — validate the reference path FIRST (mirror Phases 2 & 3)

Before any agent UI, prove the reference path end-to-end. Record in `docs/spikes-phase4.md`.

- **S-P4-1 ❗ — bridge relays hermes.** A desktop script (Telegram **MTProto / user account**,
  Telethon-class) logs into *your* Telegram, sends a message to the **hermes bot**, and captures
  its reply(ies). **Pass:** a round-trip works. **Fail → rethink hermes:** if a user-account relay
  can't reach the bot, hermes-on-tether needs another door (or hermes exposes HTTP directly).
  *(Bot API is rejected up front: hermes already owns/polls its bot token — a second poller
  conflicts, and a bot can't DM you first.)*
- **S-P4-2 ❗ — bridge is reachable from the PWA origin.** The bridge exposes HTTP/SSE, fronted by
  **Tailscale Serve TLS**, and the installed PWA (github.io origin) reaches it — **CORS + valid
  cert**, exactly the Phase 2/3 gate. **Fail → fix:** same Serve/CORS levers as before.
- **S-P4-3 — an agent turn streams end-to-end.** Through the bridge, tether sends a prompt and the
  reply **streams** back (message-by-message or token-ish), including the agent narrating a tool it
  ran. **Pass:** the stop-signal loop is real.

**Build agent UI only once S-P4-1/2 pass.** These are architecture gates: if the bridge can't
relay hermes or the phone can't reach it, stop and rethink before writing UI.

## 5. The generic agent-endpoint protocol (Track A keystone)

Keep it dead simple and **reuse Phase 3's OpenAI-compat adapter**:

- **Wire:** HTTP `POST /chat/completions`, **SSE**, OpenAI-compatible — so tether's existing
  `providers/openai.ts` parses it with little/no change. Any agent (a bridge, fam-x, a Claude-Code
  wrapper) can emit this.
- **The agent owns its tools.** For an agent endpoint tether sends **no `tools`** and runs **no
  client-side `read_file` loop** (contrast Phase 2/D10). It streams the agent's response and the
  agent narrates its own tool use.
- **Tool activity, v1 = narration.** The agent describes what it's doing in the streamed content
  ("Running `pytest`… reading `app.py`…") — as hermes already does on Telegram. tether renders it
  (markdown/code blocks). A **structured tool-activity SSE extension** (distinct activity chips,
  destructive-action confirms) is a **later enhancement**, not v1.
- **Config:** `EndpointConfig` gains **`kind: 'agent'`** (or an `agentManaged: boolean` flag on an
  openai endpoint). `createProvider` routes it to the openai adapter with the "no tools / no loop"
  behavior. Auth = per-endpoint token + Tailscale ACL, like Ollama.

> Net Track-A change is **small**: a new endpoint kind + a one-branch skip of the client-side tool
> loop + UI polish. This is the payoff of the D12 abstraction.

## 6. The desktop bridge (Track B, reference agent — separate artifact)

A small desktop server that makes **hermes** look like a generic agent endpoint:

- **Transport in:** Telegram **MTProto, user account** (Telethon/Pyrogram-class) — relays *your*
  messages to the hermes bot and reads its replies, exactly as the Telegram app does, so there's
  **no conflict** with hermes' own bot connection. (Bot API rejected — see S-P4-1.)
- **Transport out:** HTTP `POST /chat/completions` **SSE**, OpenAI-compatible (§5), behind
  **Tailscale Serve TLS**.
- **Auth / setup:** your Telegram `api_id` / `api_hash` (from my.telegram.org) + a one-time phone
  login (session cached on the desktop); the hermes bot handle. Provided at build/run time, never
  committed.
- **⚠ Security & privacy (call it out, don't hand-wave):** the bridge authenticates as **your
  Telegram account** and can read/send your messages. It runs **on your desktop only, over your
  tailnet**, session file on-device, never exposed publicly. This is a real trust boundary —
  scope it to the hermes chat, and treat the session file like a credential.
- **Packaging:** its own repo (e.g. `tether-bridge`) or a fenced `bridge/` dir — **excluded from
  the PWA build**. Public tether never imports it.

## 7. Track-A tasks (tether, public)

Each with an acceptance check; sized for single sittings.

- **P4-T1 — Agent endpoint kind.** `EndpointConfig` `kind: 'agent'` (OpenAI-compat baseUrl + key/
  token); `createProvider` builds the openai adapter in **agent mode** (no `tools`). Settings +
  chat picker offer it. **Acceptance:** configure an agent endpoint (the bridge) and select it.
- **P4-T2 — Agent turn (no client loop).** The agent turn skips `READ_FILE_TOOL` + the read_file
  loop for agent endpoints — single-pass streaming of the agent's narrated response. **Acceptance:**
  a turn against the bridge streams the reply with no client-side tool round; Ollama/OpenRouter
  turns are unchanged.
- **P4-T3 — Agent conversation UI.** Render narrated tool activity nicely (markdown, code blocks,
  maybe a subtle "agent" badge / collapsible tool narration); status reads "working…" not "reading
  files…". **Acceptance:** on-device, a hermes turn reads clearly as an agent doing work.
- **P4-T4 — GitHub demotion.** Chat/agent is the primary surface; GitHub browse/edit/commit stays
  reachable (a Browse tab, per interview) but is no longer the framing. **Acceptance:** the app
  reads as "talk to your desktop agent," and GitHub editing still works end-to-end.
- **P4-T5 — DECISIONS D15 + docs.** Ratify the reversals; note the bridge boundary.
- **Stop signal** at S-P4-3 + P4-T3 (chat with hermes through the bridge, watch it work) with GitHub
  still functional.

## 8. Track-B tasks (bridge, reference — separate artifact)

- **P4-B1 — Telegram relay.** MTProto user-account client: send to the hermes bot, capture replies
  (handle streamed edits / multi-message replies). **Acceptance:** CLI round-trip with hermes.
- **P4-B2 — HTTP/SSE facade.** Wrap the relay in an OpenAI-compat `/chat/completions` SSE server.
  **Acceptance:** `curl` streams a hermes reply.
- **P4-B3 — Tailscale Serve + CORS.** Front it with TLS; allow the github.io origin. **Acceptance:**
  the installed PWA reaches it (S-P4-2).

## 9. Non-goals (Phase 4)

- **No fam/hermes/Telegram code in public tether** — it stays generic (the whole point).
- **No hosted backend** — the agent/bridge is *your desktop*, over Tailscale (🔒4 single-user holds).
- **No Telegram client in the PWA** — single-poller conflict + not browser-clean; the bridge owns it.
- **No structured tool-activity protocol v1** — narration suffices; the rich activity UI is later.
- **Not retiring GitHub** — editing stays (interview call); 🔒3 is softened, not dropped.
- **fam-x's own server** — you build it (same endpoint shape); it drops in with no tether change.

## 10. Risks

- **Telegram MTProto + account safety** (S-P4-1) — the make-or-break, and a real trust boundary (§6).
- **Reply granularity** — hermes on Telegram may reply as whole messages / edited messages, not
  token deltas; the bridge normalizes that into SSE, and streaming may be chunkier than a raw model.
- **Bridge scope creep** — keep it a thin relay; it is not a second product.
- **fam-x still unbuilt** — Phase 4 targets the bridge/hermes now; fam-x validates the "any agent"
  claim when its server exists.
