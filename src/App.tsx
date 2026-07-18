import { useEffect } from 'react'
import { StoreProvider } from './state/StoreProvider'
import { useStore } from './state/store'
import { ChatProvider } from './chat/ChatProvider'
import { Chat } from './chat/Chat'
import { Settings } from './components/Settings'
import { Browse } from './components/Browse'
import { EditorPane } from './components/EditorPane'
import { TabBar } from './components/TabBar'

function Shell() {
  const { view, repo, token, tokenLoaded, dirty } = useStore()

  // Warn on reload/close/tab-away while there are unsaved edits (P1-T6). OPFS
  // (P1-T8) makes this recoverable, but the prompt still prevents surprise loss.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Chat is the home screen (D5) and manages its own full-viewport layout so the
  // composer can pin above the iOS keyboard — it replaces the normal shell chrome.
  if (view === 'chat') return <Chat />

  // Nav now lives in the bottom TabBar, so the shell header is just a labeled
  // context strip (and the safe-area-top spacer).
  const title = view === 'settings' ? 'Settings' : view === 'browse' ? 'Browse' : repo ? repo.name : 'Editor'

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-2 border-b border-white/10 px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-wide">{title}</h1>
        {tokenLoaded && !token && <span className="ml-auto text-xs text-white/40">no token</span>}
      </header>

      <main className="min-h-0 flex-1">
        {view === 'settings' && <Settings />}
        {view === 'browse' && <Browse />}
        {view === 'editor' && <EditorPane />}
      </main>

      <TabBar />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <ChatProvider>
        <Shell />
      </ChatProvider>
    </StoreProvider>
  )
}
