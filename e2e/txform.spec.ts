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
  await expect(page.getByText('Rs 75,000').first()).toBeVisible() // unsigned since the category-card redesign; green = income
})

test('create tags, toggle them on an expense, and see them survive a reload', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Add entry' }).click()

  // one field does both jobs — no separate "new tag" box
  const tagInput = page.getByRole('combobox', { name: 'Tags' })
  await expect(page.getByLabel('New tag')).toHaveCount(0)
  const typeTag = async (text: string) => { await tagInput.click(); await tagInput.pressSequentially(text) }
  const chips = tagInput.locator('..')
  const chip = (name: string) => chips.getByText(name, { exact: true })

  // typing a name nothing matches and pressing Enter adds it to the vocabulary, selected
  for (const name of ['meat', 'chicken', 'fruit']) {
    await typeTag(name)
    await tagInput.press('Enter')
    await expect(chip(name)).toBeVisible()
  }
  // every one is still selected — a selection must never be dropped as the tag list refetches
  for (const name of ['meat', 'chicken', 'fruit']) await expect(chip(name)).toBeVisible()

  // a name that matches an existing tag PICKS it, never creates a second one
  await chip('fruit').locator('button').click() // the chip's own × removes it
  await expect(chip('fruit')).toHaveCount(0)
  await typeTag('fru')
  await tagInput.press('Enter')
  await expect(chip('fruit')).toHaveCount(1)

  // picking from the dropdown ADDs to the selection rather than replacing it
  await chip('fruit').locator('button').click()
  await typeTag('fr')
  await page.getByRole('option', { name: 'fruit' }).click()
  for (const name of ['meat', 'chicken', 'fruit']) await expect(chip(name)).toBeVisible()

  // the form is still open — Enter in the tag field must never submit the entry
  await expect(page.getByLabel('Amount')).toBeVisible()
  await expect(page.getByText('Expense added')).toHaveCount(0)

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
