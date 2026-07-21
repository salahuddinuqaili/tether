# Review findings — post-Phase-3 (read before Phase 4)

Independent review of `main` at commit `8e57ecb` (Phase 3 shipped: multi-provider,
multi-chat, chat-page model picker, bottom-tab nav). Ranked, with `file:line` and a
suggested fix. Check items off as they're addressed.

**Overall:** the pivot (D11–D15) is well executed and the two riskiest cores — the
`Provider` abstraction and per-session streaming isolation — were traced and are
**correct**. The items below are real but mostly localized. Two are worth fixing before
building Phase 4.

---

## 🔴 Must-fix (before calling Phase 3 done / before Phase 4)

- [ ] **Session load has no error handling → blank, unusable app.**
  `src/chat/ChatProvider.tsx:98-123`. The load IIFE awaits `migrateLegacyOllama()` /
  `loadSessions()` / `getActiveBinding()` / `getEndpoints()` with no `try/catch`, and the
  "seed a fallback session" branch sits *after* the awaits. If IndexedDB rejects — corrupt
  store, or **iOS Safari evicting/denying storage** (real for a home-screen PWA) — the
  `loaded` flag never flips, `sessions` stays `[]`, and `send()` silently no-ops. Total
  availability regression vs. the old in-memory chat.
  **Fix:** wrap the load in `try/catch`; on failure, still `setLoaded(true)` and seed an
  in-memory session so the app runs (optionally surface a "couldn't restore chats" notice).

- [ ] **Real tailnet hostname published in a public doc.**
  `docs/spikes-phase2.md:4,6` commits `your-machine.your-tailnet.ts.net` + device name `your-machine`,
  and `README.md:123` links straight to it. It's the one file the scrub missed (everything
  else uses `your-machine.your-tailnet.ts.net`; `scripts/smoke-endpoints.ts` uses
  `your-machine.example.ts.net`). Not exploitable (Tailscale-ACL-gated) but it publishes the
  author's device/tailnet identity and breaks the project's own D4 / SPEC-phase4 §"no
  tailnet hostname in source" rule.
  **Fix:** replace with a placeholder in `docs/spikes-phase2.md`.
  **Related:** the branch `claude/nav-model-selection-ux-kolzft` carries screenshots that
  *visibly* show the same URL — scrub or don't merge those.

---

## 🟠 Worth fixing soon (medium)

- [ ] **A mis-tap permanently deletes a chat — no confirm, no undo.**
  `src/chat/SessionSwitcher.tsx:37` → `ChatProvider.closeSession`
  (`src/chat/ChatProvider.tsx:404-418`), persisted by `src/chat/sessions.ts:37-48`. The ✕
  is a tiny low-contrast target (`SessionSwitcher.tsx:42`, `text-white/35`).
  **Fix:** confirm or an undo window; enlarge/contrast the target.

- [ ] **Session switcher never shows which model each chat uses.**
  `src/chat/SessionSwitcher.tsx:35` renders only the derived title; the model is visible
  only for the *active* session via the picker. Half-delivers "concurrent chats with
  *different models*" — you can't tell them apart without opening each.
  **Fix:** show the model (and/or endpoint label) per tab.

- [ ] **SSE multi-line `data:` frames are silently dropped.**
  `src/llm/providers/openai.ts:194-224`, `src/llm/providers/anthropic.ts:199-243` split on
  `\n` and `JSON.parse` each `data:` line standalone — no multi-line `data:` concatenation,
  no bare-`\r` handling; a bad line is swallowed by `catch { return }`. Harmless for
  OpenAI/OpenRouter/Anthropic today, but **on the Phase 4 critical path**: a desktop-agent
  bridge is exactly the kind of arbitrary OpenAI-compat emitter that may split frames.
  **Fix:** accumulate an event's `data:` fields (joined by `\n`) until a blank line, then
  parse once; handle CRLF/CR. Land this *before* leaning on the bridge.

- [ ] **An invalid Anthropic key looks healthy.**
  `src/llm/providers/anthropic.ts:271-281` — `listAnthropicModels` returns the curated list
  on 401/network/abort, so the picker looks fine and the *first chat turn* 401s.
  **Fix:** throw on non-OK / network like `listOpenAIModels`/`listOllamaModels` do; don't
  swallow `AbortError`.

---

## 🟡 Polish (low)

- [ ] **Ollama non-2xx discards the error body** (`src/llm/providers/ollama.ts:68-70`) —
  throws `HTTP <status>` while the cloud adapters extract the provider's message. Read the
  `{"error":...}` body for parity.
- [ ] **No shape-validation on loaded sessions** (`src/chat/sessions.ts:50-56`; consumed by
  `saveSessions` `filter` at `sessions.ts:43` and `MessageList.tsx` `map`). A corrupt/legacy
  record could stop future saves or crash render. Not reachable on today's happy path (only
  `saveSessions` writes; idb VERSION never bumps) but undefended.
- [ ] **Debounced persist has no unload flush** (`src/chat/ChatProvider.tsx:126-130`) — a
  reload within 500 ms of a change loses it (e.g. send + immediate reload → user message not
  persisted). Add a `visibilitychange`/`pagehide` flush.
- [ ] **Stale intermediate text can flash mid-turn** — `resetStreaming` between tool rounds
  doesn't notify (`src/chat/streaming.ts:38-41` + `ChatProvider.tsx:271`), and the memoized
  bubble isn't re-rendered by the `reading` status, so the prior round's partial text (e.g. a
  leaked `read_file` JSON preamble) lingers until the next token. Cosmetic.
- [ ] **Picker vs. send-time endpoint fallback can disagree** after deleting an in-use
  endpoint — picker falls back to `endpoints[0]` (`src/chat/ChatModelPicker.tsx:25-26`),
  send-time to the global active (`ChatProvider.tsx:154-170`). Align them.
- [ ] **TabBar hides whenever the keyboard is open, on every surface** (`src/components/TabBar.tsx:36`
  returns null globally) — nav vanishes while typing in Browse/Settings, not just chat. Scope
  the hide to the chat composer.
- [ ] **Mid-stream error/abort releases the reader lock but never `reader.cancel()`s the body**
  (`openai.ts:228-230`, `anthropic.ts:246-248`, `ollama.ts:118-120`) — minor open-connection
  leak until GC.
- [ ] **`/v1` placement diverges** — OpenAI: `baseUrl(.../api/v1) + /chat/completions`;
  Anthropic: `baseUrl(host) + /v1/messages`. Correct today, a reconfiguration footgun.
- [ ] **Orphan tool-call id fallbacks fail silently** (`openai.ts:70`, `anthropic.ts:89`) — if
  the 1-assistant : N-results invariant ever breaks, they synthesize an unmatched id → a
  provider 400 that's hard to trace. Currently the invariant holds.
- [ ] **~184 KB gzip main chunk** (build warns >500 KB raw) — heavy for phone-first; consider
  code-splitting the cloud adapters / CodeMirror.
- [ ] **CI runs `build` but not the smoke tests** (`.github/workflows/deploy.yml`) — the
  `scripts/smoke-*` regressions need a live model / preview / keys, so a regression in session
  isolation or the adapters isn't caught automatically. At least run `smoke-endpoints`/
  `smoke-sessions` (fake-indexeddb, no network) in CI.
- [ ] **Dead code:** `clearRepo` is unused after the change-repo fix (`src/state/store.ts:62`,
  `src/state/StoreProvider.tsx:221`).
- [ ] **Stale docs:** `SPEC-phase3.md:2` still says "Draft for implementation" and `:111` still
  calls it "the (single, this phase) chat" for a shipped, multi-chat phase; `SPEC.md:65` still
  cites the deleted `ConnectionTest` (historical Phase 2 spec — low priority).

---

## Phase 4 — go in eyes-open

- **The bridge (Track B) is the make-or-break, and it's more than "point tether at it."**
  Claude Code / a Claude subscription doesn't natively speak OpenAI-compat SSE, so exposing it
  at the generic endpoint is a real build, not a config line. Spike `S-P4-1/2` first (the SPEC
  says so) and land the **SSE multi-line framing fix** (above) as part of it.
- **Two capability planes don't auto-connect.** An agent endpoint sends *no* tools and skips
  tether's client-side `read_file`, so the desktop agent works from *its own* filesystem and
  won't know which GitHub repo/branch you picked in tether unless you pass it. Decide how the
  agent learns the working context before P4-T4's "GitHub demotion," or the two halves feel
  disjoint.

---

## Verified correct — don't re-investigate

- **Provider tool-call pairing:** positional id reconstruction is correct across *parallel*
  calls and *multi-round* loops (`toOpenAIMessages`/`toAnthropicMessages`; invariant at
  `src/llm/agent.ts:170-199`).
- **Abort end-to-end:** user-cancel vs. failure cleanly separated adapter → `ChatProvider`;
  stream aborts never masquerade as `ProviderError`.
- **Security:** `anthropic-dangerous-direct-browser-access` + `x-api-key` on every Anthropic
  call incl. `listModels`; keys only in headers, never URLs; no `console.*` in `src`; guarded
  `JSON.parse` for stream frames and tool args.
- **Per-session streaming isolation & concurrency:** channels keyed by session id; `sessionId`
  passed explicitly through every async callback (a turn finalizes into its *own* session even
  if you switch mid-stream); delete aborts only that session and frees its channel. No path
  lets one chat's tokens render in another.
- **Change-repo fix:** pick-mode preserves the current repo, explicit Cancel, picker stays open
  on error (`src/components/Browse.tsx`).
- **`tsc --noEmit` and `vite build` are green** at `8e57ecb`.
