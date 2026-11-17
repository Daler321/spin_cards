import { expect, type Page, test } from '@playwright/test';

/**
 * D-169: the mini-games from «Ещё». Runs only where the flag `minigames_enabled` is on; each game
 * plays one round with the smallest quick bet and leaves a screenshot in e2e-results/shots.
 */
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e-results/shots/minigames-${name}.png`, fullPage: true });

async function openGames(page: Page): Promise<boolean> {
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  const spinButton = page.getByRole('button', { name: /^Крутить/ });
  await expect(skip.or(spinButton).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  // «Игры» at the top of the main screen opens the tiles; while the flag is off it only shows a toast.
  await page.locator('.head-action', { hasText: 'Игры' }).click();
  try {
    await expect(page.getByRole('heading', { name: 'Мини-игры' })).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.game-tile').first()).toBeVisible({ timeout: 3000 });
  } catch {
    return false;
  }
  return true;
}

async function openGame(page: Page, name: string): Promise<void> {
  await page.locator('.game-tile', { hasText: name }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function back(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Назад', exact: true }).last().click();
}

/** The first quick-amount button sets a small bet. */
async function smallBet(page: Page): Promise<void> {
  await page.locator('.mg .presets .chip-button').first().click();
}

test('mini-games: tiles and one round of each game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${String(response.status())} ${response.url()}`);
  });
  test.skip(!(await openGames(page)), 'mini-games are closed on this stack');
  await shot(page, 'tiles');

  await openGame(page, 'Минёр');
  await smallBet(page);
  await page.getByRole('button', { name: /^Начать за/ }).click();
  await page.locator('.mines-cell:not(:disabled)').first().click();
  await expect(
    page.locator('.mines-cell--safe, .mines-cell--bonus, .mines-cell--exploded').first(),
  ).toBeVisible();
  const cashout = page.getByRole('button', { name: /^Забрать/ });
  if (await cashout.isVisible()) await cashout.click();
  await expect(page.locator('.mg-result')).toBeVisible();
  await page.locator('.mg-rules summary').click();
  await shot(page, 'mines');
  await back(page);

  await openGame(page, 'Плинко');
  await page.locator('.mg-range').fill('10');
  await smallBet(page);
  await page.getByRole('button', { name: /^Пустить/ }).click();
  await expect(page.locator('.mg-result')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'plinko');
  await back(page);

  await openGame(page, 'Орёл и решка');
  await smallBet(page);
  await page.getByRole('button', { name: /^Подбросить/ }).click();
  await expect(page.locator('.mg-result')).toBeVisible({ timeout: 5000 });
  await shot(page, 'coinflip');
  await back(page);

  await openGame(page, '21');
  await smallBet(page);
  await page.getByRole('button', { name: /^Раздать/ }).click();
  const stand = page.getByRole('button', { name: 'Хватит' });
  await expect(stand.or(page.locator('.mg-result')).first()).toBeVisible();
  await shot(page, 'blackjack-hand');
  if (await stand.isVisible()) await stand.click();
  await expect(page.locator('.mg-result')).toBeVisible();
  await shot(page, 'blackjack');

  expect(errors).toEqual([]);
});
