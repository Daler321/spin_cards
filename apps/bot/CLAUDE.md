# apps/bot

grammY. В dev long polling, в prod webhook. В БД не ходит: всё через внутренний API api
(`src/api.ts`, заголовок с `INTERNAL_API_TOKEN`, маршруты в `apps/api/src/internal/`).

## Структура

- `src/main.ts` — запуск; `src/bot.ts` — команды и кнопки; `src/start.ts` — /start, реферальный
  payload `ref_КОД`, кнопка «Играть»; `src/notifier.ts`, `src/notify.ts` — доставка outbox
  уведомлений и рассылок; `src/i18n.ts` — тексты из `packages/shared/src/i18n/locales/ru/bot.json`;
  `src/env.ts` — окружение; `src/health.ts` — healthcheck.

## Соглашения

- Тексты только из `bot.json` (без обещаний заработка, без слова «казино»).
- Что и когда отправлять, решает api (`apps/api/src/notifications/`); бот только доставляет.
- Токен бота только в `apps/bot/.env` (в dev тестовый бот), не логировать. Маскировать при выводе.

## Команды

- `make check P=apps/bot` — eslint + prettier + typecheck + vitest (dot).
- `make logs s=bot` — логи бота в dev.

## Частые ошибки

- Баланс звёзд бота смотреть `getMyStarBalance` с токеном из прод `.env`, не печатая токен.
- Пришедшие по ссылке в Mini App мимо бота тоже должны проходить подписку (D-153): проверка в api.
