import { useLayoutEffect, useRef, useState } from 'react'
import { useChat } from './ChatProvider'
import { AttachSheet } from './AttachSheet'

// On a touch device the Return key should insert a newline (users tap the send
// button); on a desktop pointer, Enter sends and Shift+Enter inserts a newline.
const coarsePointer =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

const MAX_TEXTAREA_PX = 140

// Keyboard-pinned composer. Optimistic: tapping send clears the input and appends
// the user bubble on the same frame; the network call happens after. Keeps focus so
// the keyboard never dismisses mid-conversation (SPEC §3).
export function Composer() {
  const { send, stop, status, attachments, removeAttachment, retry } = useChat()
  const [text, setText] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const busy = status === 'streaming' || status === 'reading'

  // Auto-grow to fit content, capped — runs after the DOM reflects `text`, so
  // clearing on send shrinks it back to one line.
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_PX)}px`
  }, [text])

  function onSend() {
    if (!text.trim()) return
    const toSend = text
    setText('') // same-frame clear — zero perceived latency
    send(toSend)
    taRef.current?.focus()
  }

  return (
    <div
      className="border-t border-white/10 bg-bg px-2 pt-2 pb-2"
      // The bottom TabBar owns the safe-area inset; when the keyboard is open the
      // tab bar hides and the composer sits directly above the keyboard.
    >
      {status === 'error' && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-300">
          <span className="min-w-0 flex-1">Couldn't reach the model.</span>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-white/80 hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.path}
              className="flex max-w-full items-center gap-1 rounded-full border border-white/15 bg-surface px-2 py-1 text-xs text-white/80"
            >
              <span className="truncate">📎 {a.path}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.path)}
                className="shrink-0 text-muted hover:text-white"
                aria-label={`Remove ${a.path}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Attach a file"
          title="Attach a file"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 hover:bg-white/10"
        >
          <span className="text-base leading-none">＋</span>
        </button>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !coarsePointer) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={1}
          placeholder="Message your model…"
          autoCapitalize="sentences"
          className="max-h-[140px] flex-1 resize-none rounded-2xl border border-white/10 bg-surface px-3 py-2 text-sm leading-5 outline-none focus:border-accent"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/80 hover:bg-white/10"
          >
            <span className="h-3 w-3 rounded-[2px] bg-white/80" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!text.trim()}
            aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-black disabled:opacity-30"
          >
            <span className="text-lg leading-none">↑</span>
          </button>
        )}
      </div>

      {sheetOpen && <AttachSheet onClose={() => setSheetOpen(false)} />}
    </div>
  )
}
