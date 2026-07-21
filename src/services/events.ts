// In-process change notifications per household — drives the SSE live-sync stream.
// ponytail: single app instance; needs external pub/sub only if we ever scale horizontally.

type Send = () => void

const subscribers = new Map<string, Set<Send>>()

export function subscribe(householdId: string, send: Send) {
  let set = subscribers.get(householdId)
  if (!set) subscribers.set(householdId, (set = new Set()))
  set.add(send)
  return () => {
    set.delete(send)
    if (set.size === 0) subscribers.delete(householdId)
  }
}

/** Tell every open client of the household that something changed. */
export function notify(householdId: string | null) {
  if (!householdId) return
  for (const send of subscribers.get(householdId) ?? []) {
    try { send() } catch { /* one dead stream must not break the rest */ }
  }
}
