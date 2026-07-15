import { StoreProvider } from './state/StoreProvider'
import { useStore } from './state/store'
import { Editor } from './editor/Editor'
import { Settings } from './components/Settings'
import { Browse } from './components/Browse'

const SAMPLE = `// tether — Phase 1
// Open Settings (gear) to connect a token, then Browse to open a repo file.

function greet(name: string): string {
  return \`hello, \${name}\`
}

console.log(greet('tether'))
`

function Shell() {
  const { view, setView, repo, branch, token, tokenLoaded } = useStore()

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-2 border-b border-white/10 px-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <button
          type="button"
          onClick={() => setView('browse')}
          className="flex items-center gap-2"
          title="Browse repo"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
          <h1 className="text-sm font-semibold tracking-wide">tether</h1>
        </button>

        {repo && (
          <button
            type="button"
            onClick={() => setView('browse')}
            className="min-w-0 truncate rounded px-1.5 py-0.5 text-xs text-white/60 hover:bg-white/10"
            title="Browse repo"
          >
            {repo.owner}/{repo.name}
            {branch ? `@${branch}` : ''}
          </button>
        )}

        <span className="ml-auto flex items-center gap-3 text-xs text-white/40">
          {tokenLoaded && !token && <span>no token</span>}
          <button
            type="button"
            onClick={() => setView(view === 'settings' ? 'browse' : 'settings')}
            className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
        </span>
      </header>

      <main className="min-h-0 flex-1">
        {view === 'settings' && <Settings />}
        {view === 'browse' && <Browse />}
        {view === 'editor' && <Editor initialDoc={SAMPLE} filename="sample.ts" />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
