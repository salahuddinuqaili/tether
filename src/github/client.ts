// Thin REST client for api.github.com. The browser talks to GitHub directly
// (GitHub's API sends CORS headers) — there is no backend (DECISIONS 🔒 4/6).
// A client instance is bound to one PAT; the token is only ever placed in the
// Authorization header of a request to api.github.com and is never logged.
const API_BASE = 'https://api.github.com'

// Errors carry the HTTP status so the UI can map them to friendly messages —
// notably 401 (bad/expired token) and 409 (stale sha on commit, see P1-T7).
export class GitHubError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

export interface GitHubUser {
  login: string
  name: string | null
  avatar_url: string
}

interface RequestInitLike {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  // Low-level request. Serializes JSON bodies, attaches auth + versioned Accept
  // headers, and normalizes GitHub's error envelope into a GitHubError.
  async request<T>(path: string, init: RequestInitLike = {}): Promise<T> {
    const res = await fetch(API_BASE + path, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })

    if (!res.ok) {
      throw new GitHubError(res.status, await describeError(res))
    }
    // 204 No Content and other empty bodies parse to undefined.
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  // Validate the PAT by resolving the authenticated user (P1-T2).
  getUser(signal?: AbortSignal): Promise<GitHubUser> {
    return this.request<GitHubUser>('/user', { signal })
  }
}

// Turn a failed response into a human-readable message. GitHub returns
// { message, documentation_url }; fall back to the status text.
async function describeError(res: Response): Promise<string> {
  let apiMessage = ''
  try {
    const data = (await res.json()) as { message?: string }
    apiMessage = data.message ?? ''
  } catch {
    // non-JSON body; ignore
  }
  switch (res.status) {
    case 401:
      return 'Invalid or expired token. Check the PAT and its permissions.'
    case 403:
      return apiMessage.toLowerCase().includes('rate limit')
        ? 'GitHub rate limit reached. Try again shortly.'
        : apiMessage || 'Access forbidden — token may lack the required scope.'
    case 404:
      return apiMessage || 'Not found — check the repo/path and token access.'
    default:
      return apiMessage || res.statusText || `GitHub request failed (${res.status})`
  }
}
