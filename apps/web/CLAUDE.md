# apps/web

Telegram Mini App: React + Vite, TanStack Query, zustand, Framer Motion (`motion/react`), i18next.
Карта файлов: скилл `codebase-map`, раздел apps/web.

## Структура и соглашения

- `src/screens/` — экраны (ленивая загрузка через `lib/lazyScreen.ts`), `src/components/` — части,
  `src/lib/` — чистые помощники, `src/state/` — zustand, `src/api/queries.ts` — все запросы и мутации.
- Баланс и любые числа только из ответов сервера; оптимистичных обновлений денег нет. Мутации через
  `mutation(...)` в `queries.ts` (сам добавляет `idempotencyKey`, повтор с тем же ключом).
- Тексты только `t('ns:key')`; ключи в `packages/shared/src/i18n/locales/ru/*.json`. Деньги
  `formatMoney`, проценты `formatPercentBp` из `lib/format.ts`.
- Все стили в `src/styles.css` (токены на `:root`, тёмная тема); карта в
  `components/card/card.css` и `card-<design>.css`. Анимации отключаются при `prefers-reduced-motion`.
- Нажатие: глобальный `button:active` в `styles.css`; новые кнопки получают эффект сами.
- Слова для игрока простые (D-155): «Крутить», «Забрать деньги», «Оставить карту», «Мои карты».
- Telegram: `ready/expand`, кнопка «Назад», haptics (`app/telegram.ts`).
  Ассеты карт только свои (SVG/CSS), без сторонних картинок; шрифт один — PT Serif из
  `src/assets/fonts` (D-168), не с CDN; цель 60 fps.
- Палитра своя (D-168), не из `themeParams`: токены `--bg`, `--line`, `--gold`, `--cream`, `--serif`.
- Дизайн карты по сезону (D-168): класс `gc--d-<design>`; `card.css` — `classic`, поверх него
  `card-<design>.css`. Альбом показывает `card.design` трофея, остальное — `useSeasonCardDesign()`.
- localStorage только для удобств (обучение, подсказки), всегда в try/catch.

## Команды (из корня, всё в Docker)

- `make check P=apps/web` — eslint + prettier + typecheck + vitest (dot). Своего скрипта `test`
  нет: тесты собирает корневой `vitest.config.ts` (projects), `make check` запускает их из папки.
- `make e2e` — Playwright против запущенного dev-стека (`make up`), смартфон Pixel 7, вход через
  dev-авторизацию. Скриншоты в `apps/web/e2e-results/`.
- Для проверки своего кода без общего стека: временный vite с proxy `/api → http://proxy` в сети
  `spincards_default` (так делалось из worktree).

## Частые ошибки (уже были)

- Тесты и e2e ищут кнопки по русскому тексту: после смены слов обновить `test/*.tsx`, `e2e/*.ts`.
- При слиянии соседних CSS-блоков git может потерять `}`: после merge гонять prettier/lint.
- Не прятать валютный переключатель: доллар — вторая валюта (D-156), старт всегда в рублях.
- `ResultPanel` показывает баланс карты, а «Забрать» — `cashoutValue` (с комиссией): не путать.
- Строковый ключ i18n нельзя превращать в группу ключей, пока его используют: `t()` вернёт объект,
  и React уронит всё приложение (так было с `common:more` в кошельке).
- Покупка за монеты из кошелька — сначала `guard(currency, price)` из `lib/useWalletGuard.ts` (D-166).

## Согласовывать

- Типы ответов меняются в `packages/shared/src/api.ts` вместе с api.
- Бандл ≤ 500 КБ gzip; новые зависимости обосновать.
