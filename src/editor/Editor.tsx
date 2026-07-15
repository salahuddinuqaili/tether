import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions } from './extensions'
import { languageForFilename } from './languages'

// React wrapper around a CodeMirror 6 EditorView. The view is rebuilt only when
// `docId` changes (i.e. a different file is opened) — never on every keystroke —
// so typing stays cheap. Edits flow out through onChange; the language lives in
// a Compartment and is swapped (lazy-loaded) once the grammar resolves.
const language = new Compartment()

export function Editor({
  docId,
  initialDoc,
  filename,
  onChange,
}: {
  docId: string
  initialDoc: string
  filename: string
  onChange?: (text: string) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  // Read latest initialDoc/onChange without making them effect deps (which would
  // rebuild the view mid-edit). docId is the only trigger for a rebuild.
  const initialRef = useRef(initialDoc)
  initialRef.current = initialDoc
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let cancelled = false

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialRef.current,
        extensions: [
          language.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
          }),
          ...baseExtensions(),
        ],
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
  }, [docId, filename])

  return <div ref={host} className="h-full overflow-hidden text-[13px]" />
}
