# Task breakdown — Phase 0 & Phase 1 only

Each task is sized for a single sitting and carries an explicit **acceptance check**. Do not
start Phase 1 until the Phase 0 stop signal is met. Phase 2/3 are intentionally **not** broken
down yet (see `docs/spikes-phase2.md` for what gates Phase 2).

Conventions: tasks are ordered; a later task may assume earlier ones are done. "AC" = acceptance check.

---

## Phase 0 — Skeleton
**Phase stop signal:** installs to the iPhone home screen, launches standalone (no Safari
chrome), and you can type into a syntax-highlighted buffer.

### P0-T1 — Project scaffold (Vite + React + TS + Tailwind)
Create the Vite React-TS app, add Tailwind, set dark-first base styles and the `#00FF66` accent
token. Configure Vite `base` for the GitHub Pages sub-path.
**AC:** `npm run dev` serves a dark page locally; `npm run build` produces `dist/` with correct
asset paths under the Pages base path.

### P0-T2 — PWA manifest + installability
Add `vite-plugin-pwa`. Author the Web App Manifest (`name`, `short_name`, `display: standalone`,
`theme_color`/`background_color` dark, `start_url`/`scope` matching the Pages sub-path) and a
placeholder icon set (192/512 + maskable + apple-touch-icon).
**AC:** Lighthouse "Installable" passes on the built site; manifest validates with no missing-icon
warnings.

### P0-T3 — Service worker (app shell + asset cache)
Configure the `vite-plugin-pwa` (Workbox) service worker to precache the app shell and static
assets; define an update/refresh strategy. No data caching yet (that's OPFS later).
**AC:** After first load, reloading with the network throttled offline still renders the app shell.

### P0-T4 — GitHub Pages deploy via Actions
Add a GitHub Actions workflow that builds and deploys `dist/` to Pages on push to the default
branch. Confirm HTTPS serving.
**AC:** A pushed commit results in a live `https://…github.io/<repo>/` URL serving the app over HTTPS.

### P0-T5 — Install to the iPhone home screen (real device)
On the actual iPhone (14 Pro Max), open the deployed URL in Safari → Add to Home Screen → launch.
**AC:** Launches **standalone** (no Safari address bar / chrome); app shell renders.

### P0-T6 — CodeMirror 6 buffer with syntax highlighting
Mount a CodeMirror 6 editor with the DECISIONS.md MVP extension set (line numbers, history,
bracket close/match, line wrapping, one-dark theme) and one language (JS/TS) wired up. Seed with a
sample file in component state (no persistence yet).
**AC:** Typing works; JS/TS syntax is highlighted; lines wrap (no horizontal scroll) on the phone.

### P0-T7 — Mobile editing UX spike
Test the editor against the iOS software keyboard on the real device: caret visibility, scroll,
selection handles, viewport/`safe-area` insets. Note (don't necessarily build) whether a key
accessory bar (Tab / indent / brackets) is needed.
**AC:** A short written note in `docs/` recording what works, what's painful, and the decision on a
key accessory bar — captured before Phase 0 closes.

> **Phase 0 done when:** P0-T5 (standalone install) **and** P0-T6 (highlighted, editable buffer)
> both pass on the real iPhone.

---

## Phase 1 — GitHub (the "update GitHub" requirement)
**Phase stop signal:** pull a file from a real repo, edit it on the phone, and watch the commit
land on GitHub. Usable mobile git editor on its own, zero LLM.

### P1-T1 — PAT entry + on-device storage (IndexedDB)
A settings view to paste a fine-grained PAT; persist it in IndexedDB; provide clear/remove.
Token never leaves the device and is never logged.
**AC:** Enter a PAT, reload the app, and it's still present; "remove" wipes it; nothing token-related
appears in console/network logs except the GitHub `Authorization` header.

### P1-T2 — GitHub client + auth validation
A thin REST client (fetch wrapper) that sends the `Authorization: Bearer <PAT>` header. Validate
the token via `GET /user` and surface a clear error on 401.
**AC:** With a valid PAT, the authed user's login renders; with a bad PAT, a friendly "invalid token"
message shows instead of a crash.

### P1-T3 — Repo + branch selection
Let the user pick a repo (from a typed `owner/repo` or a list via the API) and a branch (default
branch preselected).
**AC:** Selecting a real repo/branch is remembered for the session and drives subsequent tree/file calls.

### P1-T4 — Browse repo tree
Render the repo file tree for the selected branch (Contents API per directory, or Git Trees API for
the whole tree). Directories expand; files are tappable.
**AC:** The tree of a real repo renders and is navigable down into subdirectories on the phone.

### P1-T5 — Open a file into the editor
Tapping a file fetches its contents (Contents API; base64-decode) and loads it into the CodeMirror
buffer, picking the language by file extension (lazy-load grammar). Retain its `sha` for committing.
**AC:** Open a real file; correct contents and syntax highlighting appear; the blob `sha` is held in state.

### P1-T6 — Edit + dirty-state tracking
Track modified vs. saved state; reflect a clear "unsaved changes" indicator; warn before discarding.
**AC:** Editing flips a visible dirty indicator; navigating away from unsaved changes prompts a confirm.

### P1-T7 — Commit a single file (Contents API)
A commit action: `PUT /repos/{owner}/{repo}/contents/{path}` with base64 content, the held `sha`,
a commit message, and target branch. Handle 409 `sha`-mismatch (stale file) with a clear message and
a re-fetch path.
**AC:** Edit a file on the phone, commit with a message, and **see the commit land on GitHub** with the
new content; the buffer returns to a clean state with the updated `sha`.

### P1-T8 — OPFS buffer cache (resilience)
Persist open-file buffers to OPFS so an app reload / eviction-survivable session restores unsaved work.
Keep GitHub as source of truth; OPFS is cache only.
**AC:** Edit a file, fully reload the standalone PWA, and the unsaved buffer is restored from OPFS.

### P1-T9 — Graceful degradation note
Confirm the editor + git flow works with **no LLM configured at all** (it must — Phase 2 isn't built).
**AC:** With zero LLM/Ollama config present, browse → open → edit → commit completes end to end.

> **Phase 1 done (= MVP done) when:** P1-T7 (commit lands on GitHub) passes on the real iPhone, with
> P1-T1 (on-device PAT) and P1-T8 (OPFS restore) in place.
