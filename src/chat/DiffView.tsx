import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'
import { languageForFilename } from '../editor/languages'

// Read-only unified diff (@codemirror/merge) of a proposed edit: the editor holds the
// NEW file; `original` supplies the baseline, so additions highlight and deletions show
// inline. Language is lazy-loaded into a Compartment, mirroring the Phase 1 editor.
export function DiffView({
  baseline,
  proposed,
  filename,
}: {
  baseline: string
  proposed: string
  filename: string
}) {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let cancelled = false
    const language = new Compartment()

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: proposed,
        extensions: [
          language.of([]),
          lineNumbers(),
          EditorView.lineWrapping,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          oneDark,
          unifiedMergeView({ original: baseline, mergeControls: false }),
        ],
      }),
    })

    languageForFilename(filename).then((lang) => {
      if (!cancelled && lang) view.dispatch({ effects: language.reconfigure(lang) })
    })

    return () => {
      cancelled = true
      view.destroy()
    }
  }, [baseline, proposed, filename])

  return <div ref={host} className="max-h-[50dvh] overflow-auto text-[12px]" />
}
