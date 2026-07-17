import { useEffect, type RefObject } from 'react'

// Keyboard-pinned layout (SPEC §3). iOS does NOT shrink the layout viewport when
// the keyboard opens — only the *visual* viewport shrinks and shifts. So a plain
// `position: fixed; bottom: 0` composer ends up hidden behind the keyboard. We
// instead size the chat root to the visual viewport and translate it by the
// viewport's offsetTop, so the whole surface (and the composer at its bottom) stays
// glued to the visible area as the keyboard opens/closes. No `100vh` anywhere.
export function useVisualViewport(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!el || !vv) return

    const apply = () => {
      el.style.height = `${vv.height}px`
      el.style.transform = `translateY(${vv.offsetTop}px)`
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    // Orientation changes fire on window, not always on visualViewport.
    window.addEventListener('orientationchange', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [ref])
}
