import { Editor } from './editor/Editor'

const SAMPLE = `// tether — Phase 0 skeleton
// Type here. This buffer is local-only: no GitHub, no LLM yet.
// Source of truth (GitHub) and your desktop model arrive in Phase 1 & 2.

function greet(name: string): string {
  return \`hello, \${name}\`
}

console.log(greet('tether'))
`

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-2 border-b border-white/10 px-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <h1 className="text-sm font-semibold tracking-wide">tether</h1>
        <span className="ml-auto text-xs text-white/40">Phase 0 · local buffer</span>
      </header>

      <main className="min-h-0 flex-1">
        <Editor initialDoc={SAMPLE} filename="sample.ts" />
      </main>
    </div>
  )
}
