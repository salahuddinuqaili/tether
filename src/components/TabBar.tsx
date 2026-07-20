import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { View } from '../state/store'

// Labeled bottom tab bar (P3-T6) — the obvious, thumb-reachable nav the review
// asked for, replacing the faint repo pill + tiny ⚙. Three destinations: Chat,
// Browse (GitHub), Settings. The editor is a focused sub-surface of Browse, so it
// highlights the Browse tab. Hidden while the keyboard is open so the chat's
// keyboard-pinned composer stays glued to the keyboard (SPEC §3) — the tab bar owns
// the bottom safe-area, so the composer/commit bars don't double it.

const TABS: Array<{ view: View; label: string; icon: string }> = [
  { view: 'chat', label: 'Chat', icon: '💬' },
  { view: 'browse', label: 'Browse', icon: '📁' },
  { view: 'settings', label: 'Settings', icon: '⚙️' },
]

// iOS keeps the layout viewport tall when the keyboard opens; only the visual
// viewport shrinks. A large gap between them means the keyboard is up.
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const check = () => setOpen(window.innerHeight - vv.height > 120)
    check()
    vv.addEventListener('resize', check)
    return () => vv.removeEventListener('resize', check)
  }, [])
  return open
}

export function TabBar() {
  const { view, setView } = useStore()
  const keyboardOpen = useKeyboardOpen()
  if (keyboardOpen) return null

  // The editor lives under the GitHub/browse flow → light up Browse there.
  const activeView: View = view === 'editor' ? 'browse' : view

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-white/10 bg-bg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const active = tab.view === activeView
        return (
          <button
            key={tab.view}
            type="button"
            onClick={() => setView(tab.view)}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
              active ? 'text-accent' : 'text-white/45 hover:text-white/70'
            }`}
          >
            <span className="text-lg leading-none" aria-hidden>
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
