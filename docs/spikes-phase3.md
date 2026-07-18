# Phase 3 cloud spikes — VALIDATE BEFORE BUILDING ANY PROVIDER UI

> ## ⏳ GATE PENDING
> Run the spike page from the **github.io origin** (desktop **and** the real iPhone in
> standalone) and record the verdicts below. Build provider UI (T3/T4) only once **S-P3-1**
> passes (and, for Anthropic, once **S-P3-2**'s CORS gate passes).
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

- **Desktop verdict:** _TBD_
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

- **Desktop verdict (CORS gate):** _TBD_
- **iPhone (standalone) verdict (CORS gate):** _TBD_
- **End-to-end streaming (real key):** _TBD — pending Anthropic key_

## S-P3-3 — Streaming actually streams (SSE, both providers)
**Question:** Do `data:` chunks arrive progressively (not one buffered blob), as validated for
Ollama NDJSON in P2-T2?
**Do:** The spike page logs first-token latency and per-chunk spread for each provider.
**Pass:** multiple chunks arrive spread over time. **Fail → fix:** proxy/CDN buffering — a
response-handling tweak, not an architecture change.

- **OpenRouter streaming verdict:** _TBD_

---

## Spike gate (exit criteria)

Proceed to build provider UI (T3 OpenRouter, T4 Anthropic) **only if**:
- **S-P3-1 passes** — else OpenRouter defers to Phase 4 (no proxy). This is the hard gate; the
  whole "tether talks to arbitrary browser-callable endpoints" thesis rides on it.
- **S-P3-2's CORS gate passes** for T4 to be built — else Anthropic-API support defers to Phase 4.

T1 (the `Provider` abstraction, an Ollama-only refactor) and T2 (endpoint config store) do **not**
depend on this gate and can proceed in parallel; the gate blocks only the cloud adapters and their UI.
