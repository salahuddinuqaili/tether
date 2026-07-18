// Per-session external store for in-flight assistant text (P3-T7, generalizing D9).
// Each session owns its own channel, so multiple sessions can stream at once and a
// token landing in one session notifies ONLY that session's active bubble (via
// useSyncExternalStore) — the message list and every finalized/other-session bubble
// stay put. This preserves the SPEC §3 "only the streaming bubble re-renders"
// guarantee across concurrent sessions, and is why we do NOT use one global buffer.

type Listener = () => void

interface Channel {
  text: string
  listeners: Set<Listener>
}

const channels = new Map<string, Channel>()

function channel(id: string): Channel {
  let c = channels.get(id)
  if (!c) {
    c = { text: '', listeners: new Set() }
    channels.set(id, c)
  }
  return c
}

export function getStreamingText(id: string): string {
  return channels.get(id)?.text ?? ''
}

export function appendStreaming(id: string, delta: string): void {
  const c = channel(id)
  c.text += delta
  for (const l of c.listeners) l()
}

// Reset the buffer for the next round/turn. No emit: the bubble re-renders from its
// committed content once the turn finalizes and no longer subscribes.
export function resetStreaming(id: string): void {
  const c = channels.get(id)
  if (c) c.text = ''
}

export function subscribeStreaming(id: string, listener: Listener): () => void {
  const c = channel(id)
  c.listeners.add(listener)
  return () => {
    c.listeners.delete(listener)
  }
}

// Drop a closed session's channel so it can't leak memory across a long-lived app.
export function disposeStreaming(id: string): void {
  channels.delete(id)
}
