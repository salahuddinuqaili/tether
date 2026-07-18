import { memo, useCallback, useSyncExternalStore } from 'react'
import { getStreamingText, subscribeStreaming } from './streaming'
import { parseProposedEdits } from './edits'
import { DiffCard } from './DiffCard'
import type { UiMessage } from './types'

// One message. Memoized on its props: while a turn streams, the placeholder object
// (and sessionId) are stable, so this wrapper does NOT re-render per token — only its
// <LiveContent> child (which subscribes to this session's streaming channel) does. On
// finalize the message object changes once, swapping in the parsed content. The
// wrapper stays mounted across that swap (stable key), so the entrance animation
// never replays.
export const MessageBubble = memo(function MessageBubble({
  message,
  sessionId,
}: {
  message: UiMessage
  sessionId: string
}) {
  const isUser = message.role === 'user'
  // A finalized assistant turn may carry tether-edit blocks → render prose + diff
  // card(s), and widen the bubble so the diff has room.
  const parsed = !isUser && !message.streaming ? parseProposedEdits(message.content) : null
  const width = parsed?.edits.length ? 'w-full' : 'max-w-[85%]'
  const tone = isUser
    ? 'ml-auto bg-accent/15 border-accent/25 text-white'
    : message.error
      ? 'mr-auto bg-red-500/5 border-red-500/30 text-red-200'
      : 'mr-auto bg-surface border-white/10 text-white/90'

  return (
    <div
      className={`animate-msg-in ${width} rounded-2xl border px-3 py-2 text-sm ${tone}`}
      style={{ contain: 'content' }}
    >
      {message.streaming ? (
        <LiveContent sessionId={sessionId} />
      ) : parsed ? (
        <AssistantContent text={parsed.text} edits={parsed.edits} />
      ) : (
        <StaticContent content={message.content} />
      )}
    </div>
  )
})

function StaticContent({ content }: { content: string }) {
  return <div className="whitespace-pre-wrap break-words">{content}</div>
}

function AssistantContent({
  text,
  edits,
}: {
  text: string
  edits: ReturnType<typeof parseProposedEdits>['edits']
}) {
  return (
    <div>
      {text && <div className="whitespace-pre-wrap break-words">{text}</div>}
      {edits.map((edit) => (
        <DiffCard key={edit.id} edit={edit} />
      ))}
    </div>
  )
}

// Subscribes to this session's in-flight streaming channel; re-renders only itself
// per token, even while other sessions stream into their own channels (SPEC §3).
function LiveContent({ sessionId }: { sessionId: string }) {
  const subscribe = useCallback((cb: () => void) => subscribeStreaming(sessionId, cb), [sessionId])
  const getSnapshot = useCallback(() => getStreamingText(sessionId), [sessionId])
  const text = useSyncExternalStore(subscribe, getSnapshot)
  if (!text) return <TypingDots />
  return (
    <div className="whitespace-pre-wrap break-words">
      {text}
      <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent/70" aria-hidden />
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is thinking">
      <span className="h-1.5 w-1.5 rounded-full bg-white/50" style={{ animation: 'dot-pulse 1.2s infinite', animationDelay: '0ms' }} />
      <span className="h-1.5 w-1.5 rounded-full bg-white/50" style={{ animation: 'dot-pulse 1.2s infinite', animationDelay: '160ms' }} />
      <span className="h-1.5 w-1.5 rounded-full bg-white/50" style={{ animation: 'dot-pulse 1.2s infinite', animationDelay: '320ms' }} />
    </div>
  )
}
