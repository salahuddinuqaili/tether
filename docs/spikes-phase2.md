# Phase 2 infra spikes — VALIDATE BEFORE BUILDING ANY LLM UI

These spikes de-risk the §5 critical infra decisions. **Run them in order, before a single
line of LLM-feature UI is written.** Phase 2's whole premise is that an HTTPS PWA on a phone
can reach `http`-native Ollama on the desktop. If that premise fails, the architecture
changes — so prove it cheaply first with `curl` / browser console, not React components.

> Each spike is a yes/no question with a concrete check. A ❗ marks a spike whose failure
> **forces an architecture change** rather than a config tweak.

---

## S1 — Ollama reachable on the tailnet (`OLLAMA_HOST`)
**Question:** Does Ollama answer on the desktop's tailnet IP, not just localhost?
**Do:** On desktop set `OLLAMA_HOST=0.0.0.0` and restart Ollama. From the phone (or another
tailnet device): `curl http://<desktop-magicdns>:11434/api/tags`.
**Pass:** JSON list of models returns over the tailnet.
**Fail → fix:** env var not applied / firewall on the desktop blocking 11434. Config-level, not architectural.

## S2 ❗ — Tailscale Serve TLS in front of Ollama (the linchpin)
**Question:** Can we get a real `https://*.ts.net` endpoint terminating to Ollama:11434?
**Do:** `tailscale serve --bg https / http://127.0.0.1:11434` (or `tailscale serve https:443 / 127.0.0.1:11434`),
then `tailscale serve status` to confirm the mapping. From the phone browser hit
`https://<desktop>.<tailnet>.ts.net/api/tags`.
**Pass:** HTTPS request succeeds with a **valid cert** (no warning) and returns Ollama JSON.
**Fail → architecture change:** if Serve cannot front Ollama with a trusted cert, the
"HTTPS PWA → Ollama" path is dead. Fallbacks all change the design: (a) a tiny local TLS
reverse proxy on the desktop (adds a component the PRD's "no backend" ethos resists),
(b) Tailscale Funnel (exposes publicly — violates the ACL/private posture), or
(c) abandon direct-from-PWA and require a companion. **This is the make-or-break spike.**

## S3 ❗ — Mixed-content / browser security from the installed PWA
**Question:** Does the **installed, standalone PWA on iOS** (served from `https://github.io`)
actually complete a cross-origin `fetch` to the `https://*.ts.net` endpoint — not just Safari-the-browser?
**Do:** From the home-screen-installed Phase 0 shell, run a `fetch('https://<desktop>.ts.net/api/tags')`
from the console / a test button and inspect the result.
**Pass:** Response body returns; no mixed-content or security block.
**Fail → architecture change:** if iOS standalone PWAs block this even over HTTPS (stricter
than desktop Safari), the direct-call model is unviable on the actual target device and we'd
need a companion/proxy. Must be tested **on the real iPhone in standalone mode**, not desktop devtools.

## S4 — CORS preflight from the PWA origin (`OLLAMA_ORIGINS`)
**Question:** Does Ollama allow cross-origin calls from the PWA's exact origin?
**Do:** Set `OLLAMA_ORIGINS` to the Pages origin (e.g. `https://<user>.github.io`), restart Ollama.
From the PWA origin issue a real `/api/chat` POST (triggers a CORS preflight `OPTIONS`).
**Pass:** Preflight returns the right `Access-Control-Allow-Origin`; the POST succeeds.
**Fail → fix:** widen/adjust `OLLAMA_ORIGINS` (note: it gates origins, and wildcards behave
unintuitively — test the literal origin). Config-level.

## S5 — Streaming actually streams through Serve
**Question:** Do incremental `/api/chat` tokens arrive progressively through the Serve proxy,
or get buffered into one blob?
**Do:** POST `/api/chat` with `"stream": true`; read the `ReadableStream` / NDJSON chunks and
log timestamps per chunk.
**Pass:** Chunks arrive over time (the streamed-response UX the stop signal requires).
**Fail → fix:** proxy buffering. Mitigate with response-stream handling tweaks or, worst case,
fall back to non-streaming request/response (degraded UX, not an architecture change).

## S6 — Tailscale ACLs scope the port to own devices
**Question:** Is Ollama reachable **only** from your own tailnet devices?
**Do:** Add an ACL restricting `:11434` (and the Serve endpoint) to your device group; verify a
non-authorized context cannot reach it.
**Pass:** Authorized devices reach it; nothing else does.
**Fail → fix:** ACL policy edit. Security hardening, not architectural.

---

## Deployment variant — Ollama in Docker (Windows)

The spikes above assume Ollama runs natively. Containerizing changes **only where S1/S4 config
lives** (container flags instead of native env vars); the make-or-break gates (S2/S3/S5) are
unchanged, because **Tailscale Serve still runs on the Windows host, not in the container.**

**Windows specifics:**
- Docker Desktop with the **WSL2 backend**. The GPU reaches the container via the NVIDIA Windows
  driver → WSL2 → `--gpus all`. Needs a recent NVIDIA driver; confirm the image's CUDA is new
  enough for the RTX 5070 (Blackwell / sm_120) — the official `ollama/ollama` image is fine.
- **Tailscale runs as the native Windows app**, not in the container. `tailscale serve` on the
  host proxies to the port Docker Desktop publishes to Windows `localhost`.
- Always-on: `--restart unless-stopped` **plus** Docker Desktop set to start on login.

```bash
docker run -d --gpus all \
  -v ollama:/root/.ollama \                     # persist models across container recreate
  -p 127.0.0.1:11434:11434 \                    # host loopback only; Tailscale Serve is the only network path (tightens S6)
  -e OLLAMA_HOST=0.0.0.0 \                       # S1, container form
  -e OLLAMA_ORIGINS=https://<user>.github.io \  # S4, container form
  --restart unless-stopped --name ollama ollama/ollama

docker exec -it ollama ollama pull qwen2.5-coder:7b
```

Host (native Windows Tailscale): `tailscale serve --bg https / http://127.0.0.1:11434`

> Native-vs-Docker on Windows is a wash for a solo setup (native Ollama is a one-click
> installer). Docker earns its keep if you want a reproducible/shareable stack (compose) or
> expect to switch engines later (vLLM / TabbyAPI ship primarily as images).

---

## Spike gate (exit criteria for the spike pass)

Proceed to build Phase 2 LLM UI **only if S1–S6 all pass**, with S2 and S3 being the
hard gates. If **S2 or S3 fails**, stop and revisit the architecture with me before writing
any LLM UI — do not paper over it. S1/S4/S5/S6 failures are fixable in place and don't block
the design, but should be green before UI work to avoid debugging two layers at once.
