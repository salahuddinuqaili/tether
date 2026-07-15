# P1-T9 — Graceful degradation with zero LLM

**Claim:** the full Phase 1 flow — browse → open → edit → commit — works with **no LLM
or Ollama configured at all**, exactly as the Phase 1 stop signal requires.

## Why this is guaranteed structurally, not just observed

Phase 2 (the local LLM) is not built. There is **no LLM code path in the app** to fail
or block:

- No `src/llm/` module exists yet.
- `grep -rniE "ollama|llm|/api/chat|tailscale" src/` → **no matches**.
- `grep -rnE "import\.meta\.env" src/` → **no matches**: the app needs no build-time or
  runtime environment to run (per DECISIONS D4, all future LLM settings are on-device
  runtime config, never baked in). The only user-provided input is the GitHub PAT.

The GitHub flow depends only on the browser, `api.github.com`, IndexedDB, and OPFS —
never on a model. If/when Phase 2 adds an LLM client, the PRD risk table already commits
to keeping editor + git working when the desktop/model is offline; today that holds
trivially because the model does not exist in the codebase.

## The end-to-end path (all LLM-free)

| Step | Module | External call |
|------|--------|---------------|
| Connect PAT | `storage/tokens.ts`, `components/Settings.tsx` | IndexedDB only |
| Validate | `github/client.ts` `getUser` | `GET /user` |
| Pick repo/branch | `components/Browse.tsx`, `github/client.ts` | `GET /user/repos`, `/repos/…`, `/branches` |
| Browse tree | `github/tree.ts`, `components/FileTree.tsx` | `GET …/git/trees/{ref}?recursive=1` |
| Open file | `github/client.ts` `getContents`, `lib/base64.ts` | `GET …/contents/{path}` |
| Edit | `editor/Editor.tsx`, store `buffer`/`dirty` | none |
| Commit (+ 409) | `github/client.ts` `putFile`, store `commitFile` | `PUT …/contents/{path}` |
| Reload resilience | `storage/buffers.ts` (OPFS) | none |

## Verification

- **Automated, live:** `scripts/smoke-commit.mjs` walks auth → repo → **commit → read-back →
  409 → re-fetch → retry → verify → cleanup** against real GitHub with only a PAT — no LLM
  present. This is the P1-T7 proof and also exercises T2–T5.
- **On device:** connect a PAT, browse a real repo, open a file, edit, commit, and confirm
  the commit lands — with nothing LLM-related installed or configured.

**Conclusion:** zero LLM configuration is the *default and only* Phase 1 state. The mobile
git editor is complete and usable on its own, satisfying the Phase 1 stop signal.
