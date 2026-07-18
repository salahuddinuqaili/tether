# Roadmap — tether

> **North star:** a thin mobile client for **capable AI endpoints**. Your phone never runs
> the brain — it points at one, privately over your tailnet: a **local** model, a **cloud**
> model, or (the end-state) your own **desktop agent** with real tools. The phone stays a
> chat surface; the desktop does the work.

tether ships in **phases**, each ending at a hard **stop signal** — the phase isn't done
until you can actually *do the thing* on the phone. This is the whole journey and where it
stands as of **2026-07**.

---

## The arc (how the direction evolved)

tether began (Phases 0–2) as a **mobile GitHub editor wired to your desktop's local LLM** —
browse a repo, edit a file, and chat with Ollama over Tailscale. Two direction calls
reshaped it:

- **[D5](DECISIONS.md)** — the product should *feel like chatting with a coding agent*, not
  an editor with an LLM side-panel. The conversation became the centerpiece.
- **[D11](DECISIONS.md)** — the real pivot: stop being a "smart GitHub editor," become a
  **thin client for capable agent *endpoints***. Local models shipped, cloud in review; a
  desktop *agent* next.
- **[D15](DECISIONS.md)** — the end-state: the desktop grows **hands** (shell / filesystem /
  web). The phone stays thin; the brain upgrades from a *model* to an *agent*.

GitHub browse/edit/commit is still here — it just rides along as **one capability**, no
longer the point.

---

## Phases

| Phase | Delivers | Stop signal | State |
|---|---|---|---|
| **0 · Skeleton** | Installable PWA, offline app-shell, CodeMirror editor on a local buffer | Installs to the home screen; type in a highlighted buffer | ✅ **Done** |
| **1 · GitHub** | Fine-grained PAT auth; browse a repo; open / edit / **commit** a file from the phone | Pull a file, edit it, watch the commit land on GitHub | ✅ **Done** |
| **2 · Chat-first agent** | Streaming chat with your desktop model; `read_file` tool loop; diff-before-commit; apply → commit | Ask the desktop model, get a streamed answer, apply an edit | ✅ **Done** |
| **3 · Multi-provider thin client** | One `Provider` abstraction over **local Ollama + cloud** (OpenRouter, Anthropic); pick provider+model on the chat page; **concurrent multi-chat**; labeled bottom-tab nav | Two chats at once, each switched between a local and a cloud model, both streaming | 🟡 **In review** ([PR #8](https://github.com/salahuddinuqaili/tether/pull/8)) |
| **4 · Desktop agent** | A generic **HTTP/SSE agent-endpoint** kind — an endpoint that runs its *own* tools (shell/fs/web); the phone streams its work. GitHub demoted to a side capability | Chat with your desktop agent, watch it run tools + stream the result — with GitHub still working | 🔵 **Planned** ([`SPEC-phase4.md`](SPEC-phase4.md)) |

Each shipped phase has a spec: Phase 2 [`SPEC.md`](SPEC.md), Phase 3 [`SPEC-phase3.md`](SPEC-phase3.md),
Phase 4 [`SPEC-phase4.md`](SPEC-phase4.md). The "why" behind every call is in
[`DECISIONS.md`](DECISIONS.md).

---

## Phase 4 in one breath

tether stays **generic**: it speaks one HTTP/SSE agent-endpoint protocol and never knows
*which* agent it's talking to. Making a real agent reachable there is **desktop-side** —
your own daemon over Tailscale, like Ollama:

- **Any HTTP/SSE agent** (OpenAI-compatible) drops in as one more endpoint.
- Agents that live on other transports (e.g. a Telegram bot) get exposed by a **small
  desktop bridge** — kept out of the public app, so tether's code stays agent-agnostic.

No fam-specific, no vendor-specific code in the public repo — bring your own agent.

---

## Beyond Phase 4 (not committed, just the direction)

- A **structured tool-activity** stream (distinct "running `X`" chips, confirm-before-destructive) atop the narration-only v1.
- Richer agent UX — attachments, long-running tasks, notifications.
- Whatever the endpoints make possible — tether's job is to stay the thinnest good client in front of them.

---

## The compass (what won't change)

These are load-bearing and outlast any phase:

- **The phone is thin.** It never runs the model or executes code — it points at a brain.
- **No hosted backend.** Everything talks browser-direct or to *your own* desktop daemon over
  Tailscale. **Single-user per instance** — you self-host your copy.
- **Bring your own everything** — GitHub token, model/endpoint URLs, keys, agent — all runtime
  settings on-device, never baked into source.
- **Private by construction** — your tailnet, your devices, your credentials.
