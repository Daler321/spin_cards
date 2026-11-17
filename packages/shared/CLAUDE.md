# packages/shared

Общие типы, zod-схема и дефолт конфига, константы, коды ошибок, i18n. Используют все: api, web,
admin, bot, game-core. Любая правка здесь — сквозная.

## Структура

- `src/game/config-schema.ts` — `GameConfigSchema` (zod); `src/game/default-config.ts` —
  `DEFAULT_GAME_CONFIG` (числа экономики по умолчанию, комментарии с D-xxx).
- `src/game/constants.ts` — тиры, регионы, валюты, узоры, `STARTER_HOLDER_ID`, `DEFAULT_REGION`.
- `src/game/` — общие расчёты: `lifecycle.ts`, `lucky.ts`, `rewards.ts`, `stars.ts`, `card-limit.ts`.
- `src/api.ts` — типы API игрока; `src/admin.ts` — админки; `src/internal.ts` — бота; `src/texts.ts`.
- `src/errors.ts` — `ErrorCode`; ключ на каждый код в `src/i18n/locales/ru/errors.json`.
- `src/i18n/locales/ru/` — `common`, `game`, `shop`, `errors`, `bot`, `admin`; ICU plural.

## Соглашения

- Новое поле конфига: схема + дефолт + поле админки (`apps/admin/src/config-fields.ts`) + подпись в
  `admin.json`. Необязательное поле (`.optional()`) — чтобы старые версии конфига в БД оставались
  валидными. На проде значение добавляется новой версией конфига, не `config-defaults`.
- Новый код ошибки: `errors.ts` + `errors.json` в том же коммите.
- Деньги в конфиге в минимальных единицах (копейки, центы); доллары обычно в пропорции к рублям.

## Команды

- `make check P=packages/shared` — eslint + prettier + typecheck + vitest (dot).
- После любой правки: `make typecheck` (все приложения), затем тесты затронутых.
- Правка экономики в `default-config.ts`: `make sim`; тесты `seed.test.ts` считают флаги и т. п.

## Частые ошибки

- Тексты для игрока на русском и простыми словами (D-155); без «казино» и обещаний заработка.
- JSON локалей проверять на валидность после правок (python `json.load` или prettier).
