import { expect, test } from '@playwright/test'
import { onboard, type } from './util'

test('expense/income toggle switches type and category list', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Add entry' }).click()

  await expect(page.getByRole('button', { name: 'Expense', pressed: true })).toBeVisible()
  await page.getByRole('button', { name: 'Income' }).click()
  await expect(page.getByRole('button', { name: 'Income', pressed: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add income' })).toBeVisible()

  // income categories, not expense ones
  const category = page.getByRole('combobox', { name: 'Category' })
  await category.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Salary' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Groceries' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Salary' }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0) // closed after choosing
  await expect(category).toContainText('Salary')

  await type(page.getByLabel('Amount'), '75000')
  await page.getByRole('button', { name: 'Add income' }).click()
  await expect(page.getByText('Income added')).toBeVisible()

  await page.getByRole('link', { name: 'Ledger' }).click()
  await expect(page.getByText('+Rs 75,000').first()).toBeVisible()
})

test('create tags, toggle them on an expense, and see them survive a reload', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Add entry' }).click()

  // a new tag comes back selected, so it applies to the entry being written
  const newTag = page.getByLabel('New tag')
  const chips = page.getByRole('combobox', { name: 'Tags' }).locator('..')
  for (const name of ['meat', 'chicken', 'fruit']) {
    await type(newTag, name)
    await newTag.press('Enter')
    await expect(chips.getByText(name, { exact: true })).toBeVisible()
  }

  // picking from the dropdown must ADD, never replace — the bug a single-select would hide
  await chips.getByText('fruit', { exact: true }).locator('button').click() // remove its chip
  await expect(chips.getByText('fruit', { exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Tags' }).click()
  await page.getByRole('option', { name: 'fruit' }).click()
  for (const name of ['meat', 'chicken', 'fruit'])
    await expect(chips.getByText(name, { exact: true })).toBeVisible()
  await expect(page.getByLabel('Amount')).toBeVisible() // form still open

  await type(page.getByLabel('Amount'), '1800')
  await type(page.getByLabel('Note'), 'chicken breast')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()

  await page.getByRole('link', { name: 'Ledger' }).click()
  const row = page.getByRole('button').filter({ hasText: 'chicken breast' })
  await expect(row.getByText('meat', { exact: true })).toBeVisible()

  // the reload round-trips through /snapshot and the local SQLite mirror
  await page.reload()
  await expect(row.getByText('meat', { exact: true })).toBeVisible()
  await expect(row.getByText('chicken', { exact: true })).toBeVisible()
})

test('delete an entry via the confirm dialog (cancel first)', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Add entry' }).click()
  await type(page.getByLabel('Amount'), '900')
  await type(page.getByLabel('Note'), 'delete me')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()

  await page.getByRole('link', { name: 'Ledger' }).click()
  await page.getByText('delete me').click()
  await page.getByRole('button', { name: 'Delete' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Delete this entry?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('delete me').first()).toBeVisible() // still there

  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Entry deleted')).toBeVisible()
  await expect(page.getByText('delete me')).toHaveCount(0)
})
