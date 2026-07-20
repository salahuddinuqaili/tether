import { useRef } from 'react'
import { useStore } from '../state/store'
import { useChat } from './ChatProvider'
import { useVisualViewport } from './useVisualViewport'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ChatModelPicker } from './ChatModelPicker'
import { SessionSwitcher } from './SessionSwitcher'
import { TabBar } from '../components/TabBar'

// The chat-first home (D5). A viewport-tracking, full-screen surface: header +
// transcript + keyboard-pinned composer. Rendered instead of the normal app shell
// so the composer can stay glued above the iOS keyboard (see useVisualViewport).
export function Chat() {
  const { messages, status, activeSessionId } = useChat()
  const { repo, setView } = useStore()
  const rootRef = useRef<HTMLDivElement>(null)
  useVisualViewport(rootRef)

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-0 z-20 flex h-[100dvh] flex-col bg-bg"
    >
      <header
        className="border-b border-white/10 px-3 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.6rem)' }}
      >
        {/* Session switcher (P3-T7): tabs for concurrent chats + a new-chat button. */}
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <SessionSwitcher />
          <span className="shrink-0 text-xs text-white/40">
            {status === 'queued' && <span className="text-amber-400/90">queued…</span>}
            {status === 'streaming' && <span className="text-accent/80">thinking…</span>}
            {status === 'reading' && <span className="text-accent/80">reading…</span>}
          </span>
        </div>
        {/* Chat-page model/endpoint picker (P3-T5/T7) — binds the active session. */}
        <div className="mt-1.5 flex items-center">
          <ChatModelPicker />
        </div>
      </header>

      {messages.length === 0 ? (
        <Empty hasRepo={!!repo} onBrowse={() => setView('browse')} />
      ) : (
        <MessageList messages={messages} sessionId={activeSessionId} />
      )}

      <Composer />
      <TabBar />
    </div>
  )
}

function Empty({ hasRepo, onBrowse }: { hasRepo: boolean; onBrowse: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-2xl">💬</span>
      <p className="text-sm text-white/70">
        Ask your desktop model to explain, write, or change code — right from your phone.
      </p>
      {!hasRepo && (
        <button
          type="button"
          onClick={onBrowse}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
        >
          Pick a repo to work in →
        </button>
      )}
    </div>
  )
}
