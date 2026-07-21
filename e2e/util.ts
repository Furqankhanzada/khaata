import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Type into a controlled input with real keystrokes. Playwright's fill() sets the value
 * synthetically and React (19 + Base UI wrappers) misses it on some inputs — typing never does.
 */
export async function type(input: Locator, text: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.click()
    await input.press('ControlOrMeta+a')
    await input.pressSequentially(text)
    if ((await input.inputValue()) === text) return // guard against focus lost mid-typing
  }
  throw new Error(`typing "${text}" did not stick`)
}

/** Today on the e2e household's calendar — onboard() creates households in the runner's device
 *  timezone, so specs and app agree in any CI timezone. */
export const hhToday = () => new Date().toLocaleDateString('en-CA')

/** Register a fresh user and create their household; lands on the dashboard. */
export async function onboard(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await page.goto('/')
  // let the boot-time sync settle (wasm worker + snapshot 401 + local wipe) before interacting —
  // on slow CI runners it otherwise lands mid-typing and re-renders the form under the test
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await type(page.getByLabel('Name'), 'E2E Tester')
  await type(page.getByLabel('Email'), email)
  await type(page.getByLabel('Password'), 'password-123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await type(page.getByPlaceholder(/Our Home/), 'E2E Home')
  await page.getByLabel('Base currency').selectOption('PKR') // keep 'Rs' assertions deterministic
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Net this month')).toBeVisible()
  return email
}
