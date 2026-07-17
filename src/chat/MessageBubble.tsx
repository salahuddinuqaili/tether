import { memo, useSyncExternalStore } from 'react'
import { getStreamingText, subscribeStreaming } from './streaming'
import { parseProposedEdits } from './edits'
import { DiffCard } from './DiffCard'
import type { UiMessage } from './types'

// One message. Memoized on the message object: while a turn streams, the placeholder
// object is stable, so this wrapper does NOT re-render per token — only its
// <LiveContent> child (which subscribes to the streaming store) does. On finalize
// the message object changes once, swapping in the parsed content. The wrapper stays
// mounted across that swap (stable key), so the entrance animation never replays.
export const MessageBubble = memo(function MessageBubble({ message }: { message: UiMessage }) {
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
        <LiveContent />
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

// Subscribes to the in-flight streaming text; re-renders only itself per token.
function LiveContent() {
  const text = useSyncExternalStore(subscribeStreaming, getStreamingText)
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
