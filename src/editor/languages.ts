import type { Extension } from '@codemirror/state'

// Lazy-load a CodeMirror language by file extension (DECISIONS D3). Grammars are
// dynamically imported so we don't ship every language up front. Phase 0 ships
// JS/TS only; Phase 1 adds markdown/json/python/html/css here. Unknown → plain text.
export async function languageForFilename(name: string): Promise<Extension | null> {
  const ext = name.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true })
    }
    case 'ts':
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true, typescript: true })
    }
    default:
      return null
  }
}
