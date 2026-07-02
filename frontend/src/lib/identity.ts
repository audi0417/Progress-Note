import type { SpeakerRole } from '../types'

export interface StoredIdentity {
  sessionId: string
  role: SpeakerRole
  name: string
}

const KEY = 'progress-note:identity'

export function saveIdentity(identity: StoredIdentity) {
  sessionStorage.setItem(KEY, JSON.stringify(identity))
}

export function loadIdentity(sessionId: string): StoredIdentity | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredIdentity
    return parsed.sessionId === sessionId ? parsed : null
  } catch {
    return null
  }
}
