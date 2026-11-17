import { expect, type Page, test } from '@playwright/test';

/**
 * A walk through every screen of a new player: no page errors, no console errors, no server
 * errors (5xx) and no unexpected client errors (4xx) on the way.
 */
interface Problems {
  errors: string[];
  failed: string[];
}

function watch(page: Page): Problems {
  const problems: Problems = { errors: [], failed: [] };
  page.on('pageerror', (error) => problems.errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/v1/'))
      problems.failed.push(`${String(response.status())} ${response.url()}`);
  });
  return problems;
}

const tab = (page: Page, name: string) =>
  page.getByRole('navigation').getByRole('button', { name, exact: true });

async function enterGame(page: Page): Promise<void> {
  await page.goto('/');
  const skip = page.getByRole('button', { name: 'Пропустить' });
  const spinButton = page.getByRole('button', { name: /^Крутить/ });
  await expect(skip.or(spinButton).first()).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(spinButton).toBeVisible();
}

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

async function spin(page: Page, count: 1 | 2): Promise<void> {
  await pickSpin(page, count);
  await page.getByRole('button', { name: /^Крутить/ }).click();
  await page.mouse.click(200, 300);
}

/** Overlay screens close with the back button in their header. */
async function back(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Назад', exact: true }).last().click();
}

test('a new player walks through every screen without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await enterGame(page);

  // Game: one spin into the holder, a double spin cashed out at once.
  await spin(page, 1);
  await page.getByRole('button', { name: /^Оставить карту/ }).click();
  await expect(page.getByRole('button', { name: /^Крутить/ })).toBeVisible();
  await spin(page, 2);
  await page.getByRole('button', { name: /^Забрать всё в кошелёк/ }).click();
  await expect(page.getByRole('button', { name: /^Крутить/ })).toBeVisible();

  // Holder: the card screen and its top-up sheet.
  await tab(page, 'Мои карты').click();
  await page.locator('.card-tile').first().click();
  await expect(page.getByText('Удача карты')).toBeVisible();
  await page.getByRole('button', { name: 'Пополнить', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(200, 60);
  await back(page);
  await expect(page.getByRole('heading', { name: 'Мои карты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Альбом', exact: true }).click();
  await expect(page.getByText(/Мест занято/)).toBeVisible();
  await back(page);

  // Wallet, bonuses (daily reward and quests), rating with every board.
  await tab(page, 'Ещё').click();
  await page.getByRole('button', { name: /^Кошелёк/ }).click();
  await expect(page.getByRole('heading', { name: 'Кошелёк' })).toBeVisible();
  await tab(page, 'Бонусы').click();
  // The daily reward is claimed in its section (a fresh player has it waiting).
  const daily = page
    .locator('section', { hasText: 'Награда дня' })
    .getByRole('button', { name: 'Забрать', exact: true });
  if (await daily.isEnabled({ timeout: 5_000 }).catch(() => false)) await daily.click();
  // Quests open from the top of Bonuses as their own screen.
  await page.getByRole('button', { name: /^Задания/ }).click();
  await expect(page.getByRole('heading', { name: 'Задания' })).toBeVisible();
  await page.getByRole('radio', { name: /^Сезонные/ }).click();
  await back(page);
  await tab(page, 'Рейтинг').click();
  for (const board of ['Баланс', 'Коллекция', 'Очки'])
    await page.getByRole('radio', { name: board, exact: true }).click();
  await page.locator('.lb-row').first().click();
  await expect(page.locator('.player-sheet')).toBeVisible();
  await page.mouse.click(200, 40);
  await page.getByRole('radio', { name: 'Всё время' }).click();

  // Medals and the profile with its text screens, from «Ещё» (D-177: the header is not a button).
  await tab(page, 'Ещё').click();
  await page.locator('.more-tile', { hasText: 'Медали' }).click();
  await expect(page.getByText(/Медали \(/)).toBeVisible();
  await back(page);
  await page.locator('.more-tile', { hasText: 'Профиль' }).click();
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  await page.getByRole('tab', { name: 'Настройки' }).click();
  await expect(page.getByText('Автопродажа карт')).toBeVisible();
  await page
    .getByRole('button', { name: /^Шансы/ })
    .last()
    .click();
  await expect(page.getByRole('heading', { name: 'Шансы' })).toBeVisible();
  await expect(page.getByText(/к балансу/).first()).toBeVisible();
  await back(page);
  await page
    .getByRole('button', { name: /^Правила/ })
    .last()
    .click();
  await back(page);
  await page.getByRole('button', { name: /^Конфиденциальность/ }).click();
  await back(page);

  expect(problems.errors).toEqual([]);
  expect(problems.failed).toEqual([]);
});
