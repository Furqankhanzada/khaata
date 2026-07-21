// Live sync: one EventSource per app instance; the browser handles reconnection.

let es: EventSource | null = null

export function connectLive(onNudge: () => void) {
  if (es) return
  es = new EventSource('/api/v1/events')
  es.addEventListener('changed', onNudge)
}

export function disconnectLive() {
  es?.close()
  es = null
}
