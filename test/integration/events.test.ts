import { describe, expect, it } from 'vitest'
import { getApp, inviteCodeOf, json, makeUser } from '../helpers'

async function openStream(key: string) {
  const app = await getApp()
  const res = await app.request('/api/v1/events', { headers: { 'x-api-key': key } })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  return res.body!.getReader()
}

/** Read the stream until `match` appears or the timeout elapses; returns everything read. */
async function readFor(reader: ReadableStreamDefaultReader<Uint8Array>, match: string, timeoutMs: number) {
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), deadline - Date.now())),
    ])
    if (chunk === 'timeout' || chunk.done) break
    buf += decoder.decode(chunk.value)
    if (buf.includes(match)) break
  }
  return buf
}

describe('live sync events', () => {
  it('household members receive a changed event on mutation', async () => {
    const a = await makeUser()
    const b = await makeUser({ inviteCode: await inviteCodeOf(a) })
    const reader = await openStream(a.key)
    await readFor(reader, 'ping', 2000) // initial heartbeat = subscribed

    await json('/api/v1/transactions', { key: b.key, json: { type: 'expense', amount: 42, category: 'Other' } })
    const buf = await readFor(reader, 'changed', 3000)
    expect(buf).toContain('event: changed')
    await reader.cancel()
  })

  it('does not leak events across households', async () => {
    const stranger = await makeUser()
    const other = await makeUser()
    const reader = await openStream(stranger.key)
    await readFor(reader, 'ping', 2000)

    await json('/api/v1/transactions', { key: other.key, json: { type: 'expense', amount: 7, category: 'Other' } })
    const buf = await readFor(reader, 'changed', 1500)
    expect(buf).not.toContain('event: changed')
    await reader.cancel()
  })
})
