import { expect, test } from '@playwright/test'
import { type } from './util'

test('USD household: base currency drives defaults and formatting everywhere', async ({ page }) => {
  const email = `e2e-usd-${Date.now()}@test.local`
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await type(page.getByLabel('Name'), 'USD Tester')
  await type(page.getByLabel('Email'), email)
  await type(page.getByLabel('Password'), 'password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await type(page.getByPlaceholder(/Our Home/), 'USD Home')
  await page.getByLabel('Base currency').selectOption('USD')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Net this month')).toBeVisible()

  // entry form defaults to the household base, not PKR
  await page.getByRole('button', { name: 'Add entry' }).click()
  await expect(page.getByLabel('Currency')).toHaveValue('USD')
  await type(page.getByLabel('Amount'), '250')
  await type(page.getByLabel('Note'), 'usd groceries')
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByText('Expense added')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Ledger' }).click()
  await expect(page.getByText('usd groceries')).toBeVisible()
  await expect(page.getByText('$ 250').first()).toBeVisible()

  // More page: recurring placeholder and account defaults follow the base too
  await page.getByRole('link', { name: 'More' }).click()
  await expect(page.getByPlaceholder('Amount $')).toBeVisible()
  await expect(page.getByText('USD — set at creation')).toBeVisible()
  await type(page.getByPlaceholder('Account name'), 'Checking')
  await type(page.getByLabel('Opening balance'), '1200')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByText('Account added')).toBeVisible()
  await expect(page.getByText('$ 1,200').first()).toBeVisible()
})
