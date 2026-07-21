import { expect, test } from '@playwright/test'
import { onboard, hhToday, type } from './util'

test('period toggles, stepper and custom range', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Add entry' }).click()
  await type(page.getByLabel('Amount'), '3000')
  await type(page.getByLabel('Note'), 'report fodder')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()

  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('button', { name: 'Month', pressed: true })).toBeVisible()
  await expect(page.getByText('In vs out')).toBeVisible()
  await expect(page.getByText('Rs 3,000').first()).toBeVisible()

  // week view
  await page.getByRole('button', { name: 'week' }).click()
  await expect(page.getByRole('button', { name: 'Week', pressed: true })).toBeVisible()
  await expect(page.getByText('Rs 3,000').first()).toBeVisible()

  // stepping back changes the label and clears this week's spend
  await page.getByRole('button', { name: 'Previous period' }).click()
  await expect(page.getByText('Rs 3,000')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next period' })).toBeEnabled()

  // custom range — fill() with ISO values: typed digit-segments in native date inputs are
  // platform-dependent (Linux Chromium orders them differently than macOS)
  await page.getByRole('button', { name: 'Custom' }).click()
  const [from, to] = [page.locator('input[name="from"]'), page.locator('input[name="to"]')]
  const todayIso = hhToday()
  await from.fill(`${todayIso.slice(0, 7)}-01`)
  await to.fill(todayIso)
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByText('Rs 3,000').first()).toBeVisible()
  await expect(page.getByText(/change vs .* days before/)).toBeVisible()
})
