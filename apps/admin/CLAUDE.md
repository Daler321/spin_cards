# apps/admin

React + Vite. Отдельный вход: пароль + TOTP, роли `owner` / `analyst` / `support`. Только через
api (`/admin/*`, `apps/api/src/admin/`), в БД не ходит.

## Структура

- `src/App.tsx`, `src/sections.ts` — разделы и доступ по ролям; `src/api.ts` — клиент.
- `src/screens/` — Dashboard (метрики), Configs + ConfigForm (версии конфига, симуляция, активация),
  Users (игрок, ручные действия), Flags, Seasons, Payments (Stars, возвраты), Broadcasts, Texts,
  Settings (подписка на канал), Audit, Pool, Admins.
- `src/config-fields.ts` — поля формы конфига; подписи и подсказки в
  `packages/shared/src/i18n/locales/ru/admin.json`.

## Соглашения

- Каждое ручное действие уходит в api с причиной и пишется в `audit_log` на стороне api.
- Новое поле конфига: схема в `packages/shared/src/game/config-schema.ts`, значение в
  `default-config.ts`, поле здесь в `config-fields.ts`, подпись в `admin.json`.
- Активация версии конфига только после симуляции (RTP 85–110 %), это проверяет api.

## Команды

- `make check P=apps/admin` — eslint + prettier + typecheck + vitest (dot).
- В dev админка на `/admin/` через proxy; dev-аккаунт `admin` не трогать.

## Частые ошибки

- Поле `int` в форме не понимает `null`: «без лимита» выражать `0` (так сделано для
  `referral.dailyLimit`, D-158).
