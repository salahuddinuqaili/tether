import type { Extension } from '@codemirror/state'

// Lazy-load a CodeMirror language by file extension (DECISIONS D3). Grammars are
// dynamically imported so we don't ship every language up front. Unknown → plain
// text. Phase 1 baseline: JS/TS, markdown, json, python, html, css.
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
    case 'md':
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json')
      return json()
    }
    case 'py': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'html':
    case 'htm': {
      const { html } = await import('@codemirror/lang-html')
      return html()
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css')
      return css()
    }
    default:
      return null
  }
}
