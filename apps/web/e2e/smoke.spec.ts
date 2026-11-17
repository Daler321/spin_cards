import { expect, type Page, test } from '@playwright/test';

/** Every test starts in a fresh browser: a brand-new player (dev login), onboarding included. */
async function enterGame(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  const spinButton = page.getByRole('button', { name: /^Крутить/ });
  await expect(skip.or(spinButton).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(spinButton).toBeVisible();
  return errors;
}

/** A tab of the bottom navigation (the header has buttons with the same words). */
const tab = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

/** The pack button: while free spins wait it takes them in one tap, then it opens the pack sheet. */
async function pickSpin(page: Page, count: number): Promise<void> {
  const packButton = page.locator('.spin-options .option-chip').first();
  if ((await packButton.getAttribute('aria-label')) !== 'Вид прокрута') {
    await packButton.click();
    await expect(packButton).toHaveAttribute('aria-label', 'Вид прокрута');
  }
  await packButton.click();
  await page.getByRole('radio', { name: /^Базовый/ }).click();
  await page.getByRole('button', { name: 'Сколько раз крутить', exact: true }).click();
  await page.getByRole('radio', { name: `×${String(count)}`, exact: true }).click();
}

/** One Basic spin; the animation is skipped by a tap. */
async function spinOnce(page: Page): Promise<void> {
  await pickSpin(page, 1);
  await page.getByRole('button', { name: /^Крутить/ }).click();
  await page.mouse.click(200, 300);
  await expect(page.getByRole('button', { name: /^Оставить карту/ })).toBeVisible();
}

test('a new player spins, cashes the card out and keeps the next one in the holder', async ({
  page,
}) => {
  const errors = await enterGame(page);
  // The invite banner waits for 200 spins (D-162).
  await expect(page.getByRole('button', { name: /^Позови друга/ })).toHaveCount(0);

  await spinOnce(page);
  await expect(page.locator('.result-card .gc').first()).toBeVisible();
  await page.getByRole('button', { name: /^Забрать деньги/ }).click();
  await expect(page.getByRole('button', { name: /^Крутить/ })).toBeVisible();

  await spinOnce(page);
  await page.getByRole('button', { name: /^Оставить карту/ }).click();
  await expect(page.getByRole('button', { name: /^Крутить/ })).toBeVisible();

  await tab(page, 'Мои карты').click();
  await expect(page.locator('.gc').first()).toBeVisible();
  await expect(page.getByText(/^Пока пусто\. Крутите/)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the wallet and the rating open without errors', async ({ page }) => {
  const errors = await enterGame(page);
  // The wallet has no tab of its own: «Ещё» and the transfer button open it.
  await tab(page, 'Ещё').click();
  await page.getByRole('button', { name: /^Кошелёк/ }).click();
  await expect(page.getByRole('heading', { name: 'Кошелёк' })).toBeVisible();
  await tab(page, 'Игра').click();
  await page.getByRole('button', { name: /Перевод$/ }).click();
  await expect(page.getByRole('heading', { name: 'Кошелёк' })).toBeVisible();
  await tab(page, 'Рейтинг').click();
  await expect(page.getByRole('heading', { name: 'Рейтинг' })).toBeVisible();
  // The season rating opens first, with balance and collection next to the score.
  await expect(page.locator('.season-info')).toBeVisible();
  await page.getByRole('radio', { name: 'Баланс' }).click();
  await expect(page.locator('.season-info')).toBeHidden();
  await page.getByRole('radio', { name: 'Всё время' }).click();
  await expect(page.getByText(/Альбом трофеев/)).toBeVisible();
  expect(errors).toEqual([]);
});
