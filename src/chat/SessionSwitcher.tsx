import { useChat } from './ChatProvider'

// Session switcher (P3-T7): a horizontal strip of chat tabs + a new-chat button.
// Each tab shows the session title, a live dot when it's streaming/queued (so you
// can see a background chat working), and a close affordance. Tapping a tab switches
// instantly (each session keeps its own history + streaming channel).
export function SessionSwitcher() {
  const { sessions, activeSessionId, switchSession, closeSession, newSession } = useChat()

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {sessions.map((s) => {
        const active = s.id === activeSessionId
        const busy = s.status === 'streaming' || s.status === 'reading' || s.status === 'queued'
        return (
          <div
            key={s.id}
            data-testid="session-tab"
            className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              active ? 'border-accent/40 bg-accent/10 text-white' : 'border-white/10 text-white/60'
            }`}
          >
            <button
              type="button"
              onClick={() => switchSession(s.id)}
              className="flex min-w-0 items-center gap-1"
              title={s.title}
            >
              {busy && (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === 'queued' ? 'bg-amber-400' : 'bg-accent'} animate-pulse`}
                  aria-hidden
                />
              )}
              <span className="max-w-[12ch] truncate">{s.title}</span>
            </button>
            {sessions.length > 1 && (
              <button
                type="button"
                onClick={() => closeSession(s.id)}
                aria-label={`Close ${s.title}`}
                className="shrink-0 text-white/35 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={newSession}
        aria-label="New chat"
        title="New chat"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 text-white/70 hover:bg-white/10"
      >
        <span className="text-sm leading-none">＋</span>
      </button>
    </div>
  )
}
