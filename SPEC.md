# SPEC — Phase 2: Chat-first coding agent

> Status: Draft for implementation. Written after the Phase 2 transport spike passed
> (2026-07-16) and the design interview. Implement in a **fresh session**; branch
> `feat/phase-2-chat` off `main`.

## 1. Goal & stop signal

From the phone: open a repo, **chat** with your desktop model, have it propose a code
change, **review the diff, apply it, and commit** — entirely in a conversation. The editor
becomes the surface the agent acts on, not the home screen (DECISIONS **D5**).

**Stop signal:** in the chat, type a request → the agent (streaming, from your Ollama)
proposes an edit to a file → you review the diff → **Apply** → **Commit** lands on GitHub,
with no manual file editing on the happy path.

## 2. Decisions locked in the design interview (2026-07-16)

- **Edit flow:** propose → **diff** → apply → commit. Reuses the Phase 1 commit + 409 path.
- **Agent reach:** the agent **reads other repo files for context** but **edits and commits
  one file at a time** (single-file Contents API). Multi-file atomic stays Phase 3.
- **Primary UI:** **chat is the home screen**; the editor/diff is a review surface.

## 3. UX quality bar — NON-NEGOTIABLE: "as smooth as Telegram"

The chat must feel like a native messaging app, not a web form. This is a first-class
requirement, not polish-if-time. Concretely:

- **Keyboard-pinned composer.** The input bar sits directly above the iOS keyboard and never
  jumps. Use the **`visualViewport` API** (resize/scroll) to track the keyboard and translate
  the composer + list; combine with `env(safe-area-inset-bottom)`. Do **not** rely on
  `100vh` (broken under the iOS keyboard) — use `100dvh` / visualViewport height.
- **Instant, optimistic send.** Tapping send appends the user bubble and clears the input on
  the same frame — zero perceived latency; the network call happens after.
- **Buttery scroll + stick-to-bottom.** 60fps momentum scrolling; auto-scroll to the newest
  message while streaming, but **stop auto-scrolling if the user scrolls up** (scroll
  anchoring), and show a "jump to latest" affordance.
- **Streaming without jank.** Append streamed tokens by mutating only the last message's text
  node / a memoized last-bubble component — never re-render or re-diff the whole message list
  per token. Memoize messages by stable id; virtualize only if lists get long.
- **No layout shift.** Opening the keyboard, sending, and streaming must not reflow the
  history or shift bubbles. Reserve composer height; use CSS containment (`contain: content`)
  on bubbles.
- **Input never lags or loses focus** mid-conversation; typing indicator while the agent
  thinks; subtle bubble entrance transition (fast, ~120ms, not bouncy).

**Acceptance:** on the real iPhone, scrolling a long conversation is smooth, the composer
stays glued above the keyboard, sending feels instant, and streamed tokens don't cause the
list to stutter. This is explicitly tested on-device before Phase 2 is "done."

## 4. Transport (validated 2026-07-16 — gate passed)

S1/S2/S3/S4 green on the real device. Endpoint is **runtime config, never hardcoded** (D4).
`OLLAMA_HOST=0.0.0.0`, `OLLAMA_ORIGINS` includes the PWA origin. See `docs/spikes-phase2.md`
and the `phase2-transport-config` memory. **S5 (streaming through Serve)** is validated as
build task P2-T2; **S6 (ACL hardening)** is an optional follow-up.

## 5. Architecture

### 5.1 LLM client — `src/llm/client.ts`
- `POST ${ollamaUrl}/api/chat`, `stream: true`, `model` from settings. Read the
  `ReadableStream`, parse **NDJSON** chunks, emit tokens via callback/async-iterator.
  Abortable (`AbortController`). Non-streaming fallback if S5 buffers.
- Endpoint + model come from `src/storage/llm.ts` (already holds `ollama_url`; **add a
  `model` key**). Model list from `GET /api/tags` (already used by `ConnectionTest`).

### 5.2 Agent loop — `src/llm/agent.ts`
- **System prompt:** a coding agent editing `\<owner>/\<name>@\<branch>` from a phone. Seeded
  with the open file (path + content) when there is one.
- **Context gathering:** a `read_file(path)` capability so the agent can pull related files.
  Prefer Ollama **tool-calling** (qwen2.5-coder supports it); the app executes the tool via
  the Phase 1 `getContents` and feeds the result back, looping (cap ~5 reads/turn). **Fallback**
  if the local model doesn't call tools reliably: let the user `@`-attach a file from the tree.
- **Edit proposal (deterministic, not tool-dependent):** the model must return the FULL new
  file in a fenced block:
  ````
  ```tether-edit path=src/foo.ts
  <entire new file content>
  ```
  ````
  The app parses these blocks itself → `ProposedEdit { path, newContent }`. Parsing the big
  payload deterministically (rather than trusting a tool call) is far more reliable on a local
  model.

### 5.3 Diff, apply, commit
- Render `ProposedEdit` vs the current file as a **diff card** in the conversation using
  **`@codemirror/merge`** (unified view).
- **Apply:** if the target file isn't already open, `getContents` it (to hold the current
  `sha`); set `openFile` + `buffer = newContent` → this surfaces the existing **commit bar** →
  user commits through the Phase 1 flow (base64 + sha + **409 re-fetch/resolve**, untouched).

### 5.4 UI (chat-first)
- New home view `chat`: message list + composer, meeting §3. Default landing when a token +
  repo are set. Reuse Phase 1 **Browse** to choose repo/branch (the chat's working context).
- Diff cards inline with **Apply / Dismiss**. After Apply, the editor is the review surface.
- **Settings:** add a **model picker** (from `/api/tags`) beside the existing endpoint +
  connection test.

### 5.5 State (extend `src/state/store.ts`)
- `messages: ChatMessage[]` (`role`, `content`, `streaming?`, stable `id`)
- `agentStatus: 'idle' | 'streaming' | 'reading' | 'error'`
- `proposedEdit: { path: string; newContent: string } | null`
- LLM config: `ollamaUrl` (exists), `model` (new)

### 5.6 Reuse from Phase 1 (do not rebuild)
`getContents` (context reads + fetch-on-apply), `putFile` + commit + **409 handling**,
`openFile`/`buffer`/`dirty`, OPFS session cache, the GitHub client + store patterns.

## 6. Build order (each with an acceptance check)

- **P2-T1** LLM settings: model picker from `/api/tags`; persist `model`.
- **P2-T2** LLM client: streaming `/api/chat`; **prove S5** (tokens arrive progressively
  through Serve on-device).
- **P2-T3** Chat UI shell to the **§3 smoothness bar** (list + composer + streaming render;
  no edits yet). On-device smooth-scroll / keyboard test is its acceptance.
- **P2-T4** Agent context: system prompt + open-file context; `read_file` tool loop (+ fallback).
- **P2-T5** Edit-proposal parsing + diff card (`@codemirror/merge`).
- **P2-T6** Apply → editor buffer → commit (wire to Phase 1). End-to-end stop signal here.
- **P2-T7** Graceful degradation: Ollama offline → chat errors cleanly; editor + git still work.
- **P2-T8** Smoothness polish pass on the real iPhone (§3 acceptance in full).

## 7. Non-goals (Phase 2)

Multi-file atomic commits (Phase 3 / Git Data API); hunk-by-hunk partial apply; autonomous
multi-step execution without per-edit approval; conversation persistence across reloads
(nice-to-have — can add via OPFS later); voice.

## 8. Risks

- **Local-model tool-calling reliability** for `read_file` → mitigate with `@`-attach fallback
  and deterministic edit-block parsing.
- **Streaming buffering through Serve** (S5) → validate P2-T2; non-stream fallback.
- **Context length** (`OLLAMA_CONTEXT_LENGTH` default 8192) → large files overflow; cap
  included context and warn.
- **iOS PWA keyboard/scroll** is the hardest part of §3 → budget real on-device iteration.
