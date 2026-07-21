import { expect, test } from '@playwright/test'
import { onboard, type } from './util'

async function addExpense(page: import('@playwright/test').Page, amount: string, note: string, tag?: string) {
  await page.getByRole('button', { name: 'Add entry' }).click()
  await type(page.getByLabel('Amount'), amount)
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByRole('option', { name: 'Groceries' }).click()
  if (tag) {
    await type(page.getByLabel('New tag'), tag)
    await page.getByLabel('New tag').press('Enter')
    // a created tag lands selected, as a chip in the Tags field
    await expect(page.getByRole('combobox', { name: 'Tags' }).locator('..').getByText(tag, { exact: true })).toBeVisible()
  }
  await type(page.getByLabel('Note'), note)
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()
  await page.keyboard.press('Escape')
}

test('offline: app boots from local data, entries queue and sync on reconnect', async ({ page, context }) => {
  await onboard(page)

  // seed one entry online so a snapshot lands in the local mirror; wait for the SW to finish precaching
  await addExpense(page, '100', 'online seed')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect(page.getByText(/saved locally|Syncing/)).toHaveCount(0)
  await page.waitForTimeout(1500) // let the post-mutation snapshot refresh ingest

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Net this month')).toBeVisible() // booted with no network at all

  // a brand-new tag and the entry using it queue together — the server rejects unknown tags, so
  // this only survives because the outbox replays in order (tag first)
  await addExpense(page, '555', 'offline entry', 'milk')
  await expect(page.getByText('Offline — 2 saved locally')).toBeVisible()
  await page.getByRole('link', { name: 'Ledger' }).click()
  await expect(page.getByText('offline entry')).toBeVisible() // visible from local SQLite immediately

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(/saved locally|Syncing/)).toHaveCount(0, { timeout: 10_000 })

  // the entry reached the server (authenticated request from the same browser context)
  const res = await page.request.get('/api/v1/transactions')
  const txs = (await res.json()) as { note: string | null; tags: string[] }[]
  expect(txs.find((t) => t.note === 'offline entry')?.tags).toEqual(['milk'])

  // and survives a fresh reload
  await page.reload()
  await page.getByRole('link', { name: 'Ledger' }).click()
  await expect(page.getByText('offline entry')).toBeVisible()
})
