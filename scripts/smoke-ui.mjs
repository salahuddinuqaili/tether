// P3 runtime smoke — loads the BUILT app in a real headless browser (Playwright)
// and asserts it renders without crashing, the bottom-tab nav works across
// Chat/Browse/Settings (T6), the chat surface shows the session switcher + model
// picker + composer (T5/T7), and creating/switching sessions works (T7). No live
// model needed — this proves the UI renders and the session ops wire up, catching
// render-time crashes that typecheck/build can't.
//
// Prereq: a preview server serving the build. Run:
//   BASE_PATH=/tether/ npm run build && npm run preview   (in another shell)
//   node scripts/smoke-ui.mjs
// Or point at a custom URL: SMOKE_URL=http://localhost:4173/tether/ node scripts/smoke-ui.mjs

import { chromium } from 'playwright'

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/tether/'
let failures = 0
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m)
const bad = (m) => {
  failures++
  console.log('  \x1b[31m✗\x1b[0m ' + m)
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + (e.stack ? '\n      ' + e.stack.split('\n').slice(1, 4).join('\n      ') : '')))

// Mock GitHub so a seeded token validates + repo views resolve without network.
const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) })
await page.route('**://api.github.com/**', (route) => {
  const url = route.request().url()
  if (url.endsWith('/user')) return json(route, { login: 'tester', avatar_url: 'https://avatars.githubusercontent.com/u/1' })
  if (url.includes('/branches')) return json(route, [{ name: 'main', commit: { sha: 'abc' } }])
  if (url.includes('/git/trees/')) return json(route, { tree: [], truncated: false })
  if (url.includes('/user/repos')) return json(route, [])
  return json(route, {})
})
// Don't let the Ollama model-list probe hang the smoke.
await page.route('**://localhost:11434/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen2.5:7b-instruct' }] }) }))

console.log(`\nP3 runtime smoke → ${BASE}\n`)

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20_000 })
  ok('app loaded')

  // Seed a token + an Ollama endpoint so the chat is usable, then reload.
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('tether', 1)
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv')
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const put = (k, v) =>
      new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k)
        t.onsuccess = () => res()
        t.onerror = () => rej(t.error)
      })
    await put('github_pat', 'ghp_test')
    await put('provider_endpoints', [
      { id: 'ep1', kind: 'ollama', label: 'Desktop (Ollama)', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b-instruct' },
    ])
    await put('active_endpoint_id', 'ep1')
    await put('active_model', 'qwen2.5:7b-instruct')
    // A repo selection so the app lands on Chat (the surface we're smoking).
    await put('selection', { owner: 'tester', name: 'demo', defaultBranch: 'main', branch: 'main' })
  })
  await page.reload({ waitUntil: 'networkidle', timeout: 20_000 })

  const tabbar = page.locator('nav[aria-label="Primary"]')
  await tabbar.waitFor({ timeout: 10_000 })
  for (const label of ['Chat', 'Browse', 'Settings']) {
    if ((await tabbar.getByText(label, { exact: true }).count()) > 0) ok(`tab bar has "${label}"`)
    else bad(`tab bar missing "${label}"`)
  }

  // Settings tab → the endpoint manager renders.
  await tabbar.getByText('Settings', { exact: true }).click()
  await page.getByText('Model endpoints').waitFor({ timeout: 8_000 })
  ok('Settings → endpoint manager renders')

  // Browse tab → the selected repo's view renders (no crash).
  await tabbar.getByText('Browse', { exact: true }).click()
  await page.getByText('tester/demo').first().waitFor({ timeout: 8_000 })
  ok('Browse → selected repo view renders')

  // Chat tab → composer + model picker + session switcher.
  await tabbar.getByText('Chat', { exact: true }).click()
  await page.getByPlaceholder('Message your model…').waitFor({ timeout: 8_000 })
  ok('Chat → composer renders')
  // The picker loads its endpoint label async (getEndpoints), so wait for it.
  try {
    await page.getByText('Desktop (Ollama)').first().waitFor({ timeout: 8_000 })
    ok('chat model picker renders (bound endpoint · model)')
  } catch {
    bad('chat model picker missing')
  }

  const tabsBefore = await page.locator('[data-testid="session-tab"]').count()
  if (tabsBefore >= 1) ok(`session switcher shows ${tabsBefore} chat`)
  else bad('no session tabs rendered')

  // Create a second session (the "+" button carries aria-label; a session tab only a title).
  await page.locator('button[aria-label="New chat"]').click()
  await page.waitForTimeout(300)
  const tabsAfter = await page.locator('[data-testid="session-tab"]').count()
  if (tabsAfter === tabsBefore + 1) ok(`+ New chat → ${tabsAfter} concurrent sessions`)
  else bad(`new session did not appear (before ${tabsBefore}, after ${tabsAfter})`)

  // Switch back to the first session.
  await page.locator('[data-testid="session-tab"]').first().click()
  await page.waitForTimeout(150)
  ok('switching sessions does not crash')

  // Final: no uncaught render errors the whole run.
  if (errors.length === 0) ok('no console/page errors during the run')
  else bad(`console/page errors:\n    ${errors.slice(0, 8).join('\n    ')}`)
} catch (e) {
  bad(`smoke threw: ${e.message}`)
  if (errors.length) console.log('  collected errors:\n    ' + errors.slice(0, 10).join('\n    '))
  try {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400))
    console.log('  body text:\n    ' + JSON.stringify(bodyText))
  } catch {
    /* ignore */
  }
} finally {
  await browser.close()
}

console.log('')
if (failures === 0) console.log('\x1b[32mP3 UI SMOKE PASS\x1b[0m — app renders, nav + sessions work in a real browser.\n')
else {
  console.log(`\x1b[31mP3 UI SMOKE FAIL\x1b[0m — ${failures} check(s) failed.\n`)
  process.exit(1)
}
