import { StoreProvider } from './state/StoreProvider'
import { useStore } from './state/store'
import { Editor } from './editor/Editor'
import { Settings } from './components/Settings'

const SAMPLE = `// tether — Phase 1
// PAT + GitHub layer landing here. Open Settings (gear) to connect a token.

function greet(name: string): string {
  return \`hello, \${name}\`
}

console.log(greet('tether'))
`

function Shell() {
  const { view, setView, token, tokenLoaded } = useStore()

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-2 border-b border-white/10 px-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <h1 className="text-sm font-semibold tracking-wide">tether</h1>
        <span className="ml-auto flex items-center gap-3 text-xs text-white/40">
          <span>{tokenLoaded && !token ? 'no token' : 'Phase 1'}</span>
          <button
            type="button"
            onClick={() => setView(view === 'settings' ? 'editor' : 'settings')}
            className="rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
        </span>
      </header>

      <main className="min-h-0 flex-1">
        {view === 'settings' ? <Settings /> : <Editor initialDoc={SAMPLE} filename="sample.ts" />}
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
