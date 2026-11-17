import { expect, type Page, test } from '@playwright/test';

/**
 * D-170..D-176: «Ещё» with its tiles, the shop, the wheel with its rewards, craft, the profile tabs
 * and the transfer sheet with every card in reach. Leaves screenshots in e2e-results/shots.
 */
const tab = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e-results/shots/features-${name}.png`, fullPage: true });

async function back(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Назад', exact: true }).last().click();
}

async function enterGame(page: Page): Promise<void> {
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  const spinButton = page.getByRole('button', { name: /^Крутить/ });
  await expect(skip.or(spinButton).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(spinButton).toBeVisible();
}

/** Four basic spins at once, all kept in the holder. */
async function spinFourAndKeep(page: Page): Promise<void> {
  const packButton = page.locator('.spin-options .option-chip').first();
  if ((await packButton.getAttribute('aria-label')) !== 'Вид прокрута') {
    await packButton.click();
    await expect(packButton).toHaveAttribute('aria-label', 'Вид прокрута');
  }
  await packButton.click();
  await page.getByRole('radio', { name: /^Базовый/ }).click();
  await page.getByRole('button', { name: 'Сколько раз крутить', exact: true }).click();
  await page.getByRole('radio', { name: '×4', exact: true }).click();
  await page.getByRole('button', { name: /^Крутить/ }).click();
  // The reveal is still running: the spin overlay must reach the bottom edge of the screen.
  await page.waitForTimeout(600);
  const overlay = await page.locator('.stage-overlay').first().boundingBox();
  const viewport = page.viewportSize();
  if (overlay && viewport)
    expect(overlay.y + overlay.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await shot(page, 'reveal');
  await page.mouse.click(200, 300);
  await page.getByRole('button', { name: /^Оставить все карты/ }).click();
  await expect(page.getByRole('button', { name: /^Крутить/ })).toBeVisible();
}

test('new screens open without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500 && response.url().includes('/v1/'))
      errors.push(`${String(response.status())} ${response.url()}`);
  });
  await enterGame(page);
  await spinFourAndKeep(page);

  // Bug 1: the top-up sheet of a card scrolls, so the first option stays reachable.
  await tab(page, 'Мои карты').click();
  await page.locator('.card-tile').first().click();
  await page.getByRole('button', { name: 'Пополнить', exact: true }).click();
  const first = page.locator('.transfer-options .payment-option').first();
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  await shot(page, 'transfer-sheet');
  await page.keyboard.press('Escape');
  await page.mouse.click(200, 60);
  await back(page);

  await tab(page, 'Ещё').click();
  await expect(page.locator('.more-tile', { hasText: 'Донат' })).toBeVisible();
  // D-177: the search narrows the tiles.
  await page.getByRole('searchbox', { name: 'Поиск по разделам' }).fill('сезон');
  await expect(page.locator('.more-tile', { hasText: 'Сезоны' })).toBeVisible();
  await expect(page.locator('.more-tile', { hasText: 'Донат' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Поиск по разделам' }).fill('');
  await shot(page, 'more');

  await page.locator('.more-tile', { hasText: 'Донат' }).click();
  await expect(page.getByRole('heading', { name: 'Магазин', exact: true })).toBeVisible();
  await shot(page, 'shop');
  await back(page);

  await page.locator('.more-tile', { hasText: 'Колесо фортуны' }).click();
  await expect(page.getByText('Что может выпасть')).toBeVisible();
  await shot(page, 'wheel');
  await back(page);

  const craft = page.locator('.more-tile', { hasText: 'Крафт карт' });
  if (await craft.isVisible()) {
    await craft.click();
    await expect(page.getByRole('heading', { name: 'Крафт карт' })).toBeVisible();
    await shot(page, 'craft');
    await back(page);
  }

  for (const [tile, heading] of [
    ['Мини-игры', 'Мини-игры'],
    ['Рефералы', 'Пригласить друзей'],
    ['Медали', 'Медали'],
    ['Сезоны', 'Сезоны'],
    ['Коллекция игрока', 'Коллекция игрока'],
  ] as const) {
    await page.locator('.more-tile', { hasText: tile }).first().click();
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    if (tile === 'Сезоны') await expect(page.getByText('Сезонов прошло')).toBeVisible();
    if (tile === 'Рефералы')
      await expect(page.getByRole('button', { name: 'Скопировать' })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, `screen-${tile}`);
    await back(page);
  }

  await page.locator('.more-tile', { hasText: 'Профиль' }).click();
  await shot(page, 'profile-info');
  await page.getByRole('tab', { name: 'Настройки' }).click();
  await expect(page.getByText('Автопродажа карт')).toBeVisible();
  await shot(page, 'profile-settings');
  await back(page);

  await tab(page, 'Бонусы').click();
  await shot(page, 'bonuses');

  expect(errors).toEqual([]);
});
