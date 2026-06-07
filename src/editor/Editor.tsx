import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions } from './extensions'
import { languageForFilename } from './languages'

// React wrapper around a CodeMirror 6 EditorView. The language lives in a
// Compartment so it can be swapped (lazy-loaded) without rebuilding the view —
// the same hook Phase 1 will use when opening different files.
const language = new Compartment()

export function Editor({
  initialDoc,
  filename = 'untitled.txt',
}: {
  initialDoc: string
  filename?: string
}) {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let cancelled = false

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [language.of([]), ...baseExtensions()],
      }),
    })

    languageForFilename(filename).then((lang) => {
      if (cancelled || !lang) return
      view.dispatch({ effects: language.reconfigure(lang) })
    })

    return () => {
      cancelled = true
      view.destroy()
    }
  }, [initialDoc, filename])

  return <div ref={host} className="h-full overflow-hidden text-[13px]" />
}
