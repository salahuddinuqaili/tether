// UTF-8-safe base64 <-> text. GitHub's Contents API returns file content as
// base64 (with embedded newlines) and expects base64 back on commit (P1-T5/T7).
// atob/btoa alone corrupt multibyte characters, so we round-trip through bytes.

export function decodeBase64ToText(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

export function encodeTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
