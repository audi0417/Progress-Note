import type { SpeakerRole } from '../types'

export interface StoredIdentity {
  sessionId: string
  role: SpeakerRole
  name: string
}

const KEY = 'progress-note:identity'

export function saveIdentity(identity: StoredIdentity) {
  localStorage.setItem(KEY, JSON.stringify(identity))
}

export function loadIdentity(): StoredIdentity | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredIdentity
  } catch {
    return null
  }
}

export function clearIdentity() {
  localStorage.removeItem(KEY)
}
