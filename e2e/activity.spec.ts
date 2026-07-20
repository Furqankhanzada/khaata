import { expect, test } from '@playwright/test'
import { onboard, type } from './util'

test('activity log shows who did what', async ({ page }) => {
  await onboard(page)

  await page.getByRole('button', { name: 'Add entry' }).click()
  await type(page.getByLabel('Amount'), '777')
  await page.getByRole('combobox', { name: 'Category' }).click()
  await page.getByRole('option', { name: 'Groceries' }).click()
  await type(page.getByLabel('Note'), 'audit trail check')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()

  await page.getByRole('link', { name: 'More' }).click()
  await page.getByRole('link', { name: 'View activity' }).click()

  await expect(page.getByText('E2E Tester — added transaction')).toBeVisible()
  await expect(page.getByText('audit trail check')).toBeVisible()
})
