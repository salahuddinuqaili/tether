import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import type { UiMessage } from './types'

// Scrollable transcript with stick-to-bottom. Auto-scrolls to the newest content
// while streaming, but stops the moment the user scrolls up (scroll anchoring), and
// offers a "jump to latest" affordance (SPEC §3). Streaming growth is tracked with a
// ResizeObserver so the list pins to the bottom without re-rendering per token.
export function MessageList({ messages }: { messages: UiMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const prevLen = useRef(0)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  // Pin to the bottom as the streaming bubble grows (no list re-render involved).
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom('auto')
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollToBottom])

  // On a fresh user send, always snap to the bottom even if they'd scrolled up.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (messages.length > prevLen.current && last?.role === 'user') {
      stickRef.current = true
      setShowJump(false)
      scrollToBottom('auto')
    }
    prevLen.current = messages.length
  }, [messages, scrollToBottom])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 48
    stickRef.current = atBottom
    setShowJump(!atBottom)
  }, [])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="momentum-scroll h-full overflow-y-auto overscroll-contain px-3 py-4"
      >
        <div ref={contentRef} className="flex flex-col gap-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true
            setShowJump(false)
            scrollToBottom('smooth')
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-surface/90 px-3 py-1 text-xs text-white/80 shadow-lg backdrop-blur"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
