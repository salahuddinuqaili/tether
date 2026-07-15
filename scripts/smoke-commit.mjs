#!/usr/bin/env node
// Phase 1 live smoke test — proves the GitHub commit path against REAL
// api.github.com using YOUR fine-grained PAT (never committed, never logged).
// It mirrors exactly what the app does: validate the token, resolve the repo,
// write a file via the Contents API, read it back, force the 409 stale-sha case,
// re-fetch + retry, then delete the test file so nothing is left behind.
//
// Run (PowerShell):
//   $env:TETHER_PAT = "github_pat_…"; $env:TETHER_REPO = "you/your-repo"; node scripts/smoke-commit.mjs
// Run (bash):
//   TETHER_PAT="github_pat_…" TETHER_REPO="you/your-repo" node scripts/smoke-commit.mjs
//
// Optional env: TETHER_BRANCH (default: repo default), TETHER_PATH (default: tether-smoke-test.md)
//
// Requires the same token scope the app needs: Contents: read & write on the repo.

const API = 'https://api.github.com'
const PAT = process.env.TETHER_PAT
const REPO = process.env.TETHER_REPO
const PATH = process.env.TETHER_PATH || 'tether-smoke-test.md'

if (!PAT || !REPO || !REPO.includes('/')) {
  console.error('Set TETHER_PAT and TETHER_REPO=owner/repo. See the header of this file.')
  process.exit(2)
}
const [owner, repo] = REPO.split('/')

// Same request shape as src/github/client.ts (auth + versioned headers).
async function gh(path, init = {}) {
  const res = await fetch(API + path, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  return { status: res.status, ok: res.ok, data }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const unb64 = (s) => Buffer.from(s, 'base64').toString('utf8')

function ok(msg) {
  console.log('  \x1b[32m✓\x1b[0m ' + msg)
}
function fail(msg, detail) {
  console.error('  \x1b[31m✗\x1b[0m ' + msg + (detail ? `\n    ${detail}` : ''))
  process.exit(1)
}

console.log(`\nPhase 1 commit smoke test → ${owner}/${repo}:${PATH}\n`)

// 1. Validate token (P1-T2)
const me = await gh('/user')
if (!me.ok) fail('token invalid', me.data?.message)
ok(`auth: ${me.data.login}`)

// 2. Resolve repo + default branch (P1-T3)
const repoInfo = await gh(`/repos/${owner}/${repo}`)
if (!repoInfo.ok) fail('repo not accessible', repoInfo.data?.message)
const branch = process.env.TETHER_BRANCH || repoInfo.data.default_branch
ok(`repo: ${owner}/${repo} (branch: ${branch})`)

// Discover any existing sha for the test path (so re-runs update, not fail).
const encPath = PATH.split('/').map(encodeURIComponent).join('/')
const existing = await gh(`/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`)
let sha = existing.ok ? existing.data.sha : undefined

// 3. First commit — write content via Contents API (P1-T7)
const v1 = `# tether smoke test\n\nround 1 — ${new Date().toISOString?.() ?? 'now'}\n`
const c1 = await gh(`/repos/${owner}/${repo}/contents/${encPath}`, {
  method: 'PUT',
  body: { message: 'test: tether smoke round 1', content: b64(v1), branch, sha },
})
if (!c1.ok) fail('first commit failed', c1.data?.message)
const staleSha = c1.data.content.sha
ok(`PUT contents → commit ${c1.data.commit.sha.slice(0, 7)}  ${c1.data.commit.html_url}`)

// 4. Read back + verify content (P1-T5 decode path)
const read = await gh(`/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`)
if (!read.ok || unb64(read.data.content) !== v1) fail('read-back content mismatch')
ok('read back → content matches (base64 decode correct)')

// 5. Make a second real commit so the held sha goes stale, then prove the 409 path.
const v2 = v1 + 'round 1b — a concurrent change\n'
const c1b = await gh(`/repos/${owner}/${repo}/contents/${encPath}`, {
  method: 'PUT',
  body: { message: 'test: tether smoke concurrent change', content: b64(v2), branch, sha: staleSha },
})
if (!c1b.ok) fail('setup for conflict failed', c1b.data?.message)
ok(`simulated a concurrent commit ${c1b.data.commit.sha.slice(0, 7)} (held sha now stale)`)

// Attempt a commit with the STALE sha — must 409 (this is the case P1-T7 handles).
const v3 = v2 + 'round 2 — my phone edit\n'
const conflictAttempt = await gh(`/repos/${owner}/${repo}/contents/${encPath}`, {
  method: 'PUT',
  body: { message: 'test: tether stale commit (should 409)', content: b64(v3), branch, sha: staleSha },
})
if (conflictAttempt.status !== 409) fail(`expected 409, got ${conflictAttempt.status}`, conflictAttempt.data?.message)
ok('stale sha → HTTP 409 (as the app detects)')

// Re-fetch the fresh sha (the app's re-fetch path) and retry.
const refetched = await gh(`/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`)
const freshSha = refetched.data.sha
ok(`re-fetched current sha ${freshSha.slice(0, 7)}`)
const retry = await gh(`/repos/${owner}/${repo}/contents/${encPath}`, {
  method: 'PUT',
  body: { message: 'test: tether retry after 409', content: b64(v3), branch, sha: freshSha },
})
if (!retry.ok) fail('retry after 409 failed', retry.data?.message)
ok(`retry commit → commit ${retry.data.commit.sha.slice(0, 7)}  ${retry.data.commit.html_url}`)

// 6. Verify final content, then clean up the test file.
const finalRead = await gh(`/repos/${owner}/${repo}/contents/${encPath}?ref=${encodeURIComponent(branch)}`)
if (!finalRead.ok || unb64(finalRead.data.content) !== v3) fail('final content mismatch')
ok('verified final content on api.github.com')

const del = await gh(`/repos/${owner}/${repo}/contents/${encPath}`, {
  method: 'DELETE',
  body: { message: 'test: tether smoke cleanup', branch, sha: finalRead.data.sha },
})
if (del.ok) ok('cleanup → deleted test file')
else console.log(`  (leftover ${PATH} — delete manually; ${del.data?.message ?? ''})`)

console.log('\n\x1b[32mP1-T7 PASS\x1b[0m — commit lands on GitHub; 409 stale-sha is caught, re-fetched, and retried.\n')
