// External store for the in-flight assistant text. Token deltas land here and
// notify ONLY the active streaming bubble (via useSyncExternalStore) — the message
// list and every finalized bubble stay put. This is what lets streaming append
// "only the last bubble" and never re-render or re-diff the whole list per token
// (SPEC §3). Exactly one assistant message streams at a time, so a single global
// buffer is enough.

type Listener = () => void

let text = ''
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l()
}

export function getStreamingText(): string {
  return text
}

export function appendStreaming(delta: string): void {
  text += delta
  emit()
}

// Reset the buffer for the next turn. No emit: the finalized bubble has already
// re-rendered from its committed `content` and no longer subscribes.
export function resetStreaming(): void {
  text = ''
}

export function subscribeStreaming(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
