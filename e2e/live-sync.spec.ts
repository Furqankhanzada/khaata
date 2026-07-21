import { expect, test } from '@playwright/test'
import { onboard, type } from './util'

test('a change on one device appears on another without any interaction', async ({ page, context }) => {
  await onboard(page)

  // second "device": same login, ledger open, then never touched again
  const page2 = await context.newPage()
  await page2.goto('/transactions')
  await expect(page2.getByText('The ledger is empty')).toBeVisible()

  await page.getByRole('button', { name: 'Add entry' }).click()
  await type(page.getByLabel('Amount'), '321')
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByRole('option', { name: 'Groceries' }).click()
  await type(page.getByLabel('Note'), 'live push check')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()

  // SSE nudge → snapshot pull → local SQLite → re-render; 5s is far below the 5-min fallback poll
  await expect(page2.getByText('live push check')).toBeVisible({ timeout: 5000 })
})
