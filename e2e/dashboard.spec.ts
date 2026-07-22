import { expect, test } from '@playwright/test'
import { onboard, hhToday, type } from './util'

const monthLabel = (shift: number) => {
  const [y, mo] = hhToday().split('-').map(Number) // the household's month (device tz in e2e)
  const m = new Date(y, mo - 1 + shift, 1)
  return m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase()
}

test('month stepper walks back and forward', async ({ page }) => {
  await onboard(page)
  await expect(page.getByText(monthLabel(0))).toBeVisible()
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page.getByText(monthLabel(-1))).toBeVisible()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByText(monthLabel(0))).toBeVisible()
})

test('ledger search filters by note', async ({ page }) => {
  await onboard(page)
  for (const [amount, note] of [['100', 'petrol pump'], ['200', 'karahi dinner']] as const) {
    await page.getByRole('button', { name: 'Add entry' }).click()
    await type(page.getByLabel('Amount'), amount)
    await type(page.getByLabel('Note'), note)
    await page.getByRole('button', { name: 'Add expense' }).click()
    await expect(page.getByText('Expense added')).toBeVisible()
  }
  await page.getByRole('link', { name: 'Ledger' }).click()
  await expect(page.getByText('petrol pump')).toBeVisible()
  await expect(page.getByText('karahi dinner')).toBeVisible()

  await type(page.getByPlaceholder('Search notes, items, people…'), 'karahi')
  await expect(page.getByText('petrol pump')).toHaveCount(0)
  await expect(page.getByText('karahi dinner')).toBeVisible()
})
