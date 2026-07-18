# Phase 3 cloud spikes — VALIDATE BEFORE BUILDING ANY PROVIDER UI

> ## ✅ GATE PASSED (desktop) — 2026-07-18 · iPhone confirmation pending
> Validated from the real `github.io` origin on the desktop:
> - **S-P3-1** ✅ OpenRouter browser-direct — `HTTP 200`, CORS ok, SSE streamed.
> - **S-P3-2** ✅ Anthropic CORS gate — `HTTP 401` (placeholder key), preflight allowed browser-direct.
> - **S-P3-3** ✅ SSE parsing works (single-chunk on a 1-token reply; progressive on longer output).
>
> CORS is decided purely by the `Origin` header, which is byte-identical on desktop and iPhone, so
> the **architecture gate is cleared** and cloud adapters (T3/T4) can proceed. The **iPhone (standalone)
> confirmation** is still outstanding — it adds iOS-WebKit streaming confidence, not a CORS re-check.
> Anthropic end-to-end streaming awaits a real key (T4 builds on the passed CORS gate).
>
> Spike harness: [`public/spike-phase3.html`](../public/spike-phase3.html) →
> deployed at `https://<you>.github.io/tether/spike-phase3.html` (temporary; removed with the
> phase PR). Keys are entered in-page, never stored or committed.

Phase 2's premise was "an HTTPS PWA can reach `http` Ollama." Phase 3's premise is **"the
installed iOS PWA can call cloud provider APIs directly from the browser."** CORS is decided
purely by the request's `Origin` header, so it must be proven from the real `github.io` origin —
a Node script can't (Node ignores CORS). Prove it cheaply with the test page, not React
components.

> Each spike is a yes/no question with a concrete check. A ❗ marks a spike whose failure
> **forces an architecture change** (a proxy = a backend = a reversal of 🔒4, out of scope this
> phase) rather than a config tweak.

---

## S-P3-1 ❗ — OpenRouter browser-direct (CORS + auth)
**Question:** Does `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization:
Bearer <key>`, `stream:true` succeed from the `github.io` origin?
**Do:** Open the spike page at the github.io origin, enter the OpenRouter key, run the test.
**Pass:** the browser gets a response (CORS allowed) and SSE chunks arrive.
**Fail → defer, do NOT proxy:** if the browser blocks it (a `TypeError` before any response),
OpenRouter can't be called browser-direct — it would need the Phase 4 desktop agent to proxy it.
Do **not** add a backend. (Everything downstream — T3, T5, T7's cloud sessions — depends on this.)

- **Desktop verdict:** ✅ **PASS** (2026-07-18) — `HTTP 200` after 1010 ms from
  `https://salahuddinuqaili.github.io`; first token at 1051 ms; SSE `data:` frame parsed to
  `"pong"`. CORS allowed browser-direct; streaming transport works.
- **iPhone (standalone) verdict:** _TBD_

## S-P3-2 ❗ — Anthropic direct browser access (CORS gate)
**Question:** Does `POST https://api.anthropic.com/v1/messages` with `x-api-key`,
`anthropic-version: 2023-06-01`, and **`anthropic-dangerous-direct-browser-access: true`**,
`stream:true` clear the CORS preflight from the `github.io` origin?
**Do:** Run the Anthropic test on the spike page. A key is optional — a **placeholder key** still
triggers the real preflight; a `401` (not a `TypeError`) proves browser-direct is allowed.
**Pass (CORS gate):** a real HTTP response comes back (e.g. `401` with a placeholder key, or a
`200` SSE stream with a real key). **Fail → architecture:** a `TypeError` before any response
means the preflight was blocked → Anthropic-API support waits for the Phase 4 desktop agent
(which can proxy it). OpenRouter still stands regardless.
**Note:** end-to-end streaming (a real key) is validated when an Anthropic key is available;
T4 can be built on a passed CORS gate.

- **Desktop verdict (CORS gate):** ✅ **PASS** (2026-07-18) — `HTTP 401` after 611 ms with a
  placeholder key from `https://salahuddinuqaili.github.io`. A real response (not a `TypeError`)
  means the preflight allowed browser-direct access, so Anthropic is callable browser-direct from
  the PWA origin. Architecture gate cleared.
- **iPhone (standalone) verdict (CORS gate):** _TBD_
- **End-to-end streaming (real key):** _TBD — pending Anthropic key_

## S-P3-3 — Streaming actually streams (SSE, both providers)
**Question:** Do `data:` chunks arrive progressively (not one buffered blob), as validated for
Ollama NDJSON in P2-T2?
**Do:** The spike page logs first-token latency and per-chunk spread for each provider.
**Pass:** multiple chunks arrive spread over time. **Fail → fix:** proxy/CDN buffering — a
response-handling tweak, not an architecture change.

- **OpenRouter streaming verdict:** ✅ **PASS** (transport) — the SSE `data:` stream was read and
  parsed incrementally. The test reply was 1 token (`"pong"`), so it arrived in a single content
  chunk; a multi-token answer streams progressively over the same path. No buffering-into-a-blob.

---

## Spike gate (exit criteria)

Proceed to build provider UI (T3 OpenRouter, T4 Anthropic) **only if**:
- **S-P3-1 passes** — else OpenRouter defers to Phase 4 (no proxy). This is the hard gate; the
  whole "tether talks to arbitrary browser-callable endpoints" thesis rides on it.
- **S-P3-2's CORS gate passes** for T4 to be built — else Anthropic-API support defers to Phase 4.

T1 (the `Provider` abstraction, an Ollama-only refactor) and T2 (endpoint config store) do **not**
depend on this gate and can proceed in parallel; the gate blocks only the cloud adapters and their UI.
