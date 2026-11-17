# apps/api

NestJS (Fastify) + Prisma + Redis. Один код, два процесса: `src/main.ts` (HTTP) и `src/worker.ts`
(джобы). Карта файлов: скилл `codebase-map`, раздел apps/api.

## Структура и соглашения

- Модуль на область: `src/<область>/*.module.ts|controller.ts|service.ts`. Игровая логика в
  `src/game/`, деньги в `src/ledger/` и `src/wallet/`, разовые инструменты в `src/ops/*-cli.ts`.
- Контроллер: `@RateLimit(...)`, вход через `new ZodPipe(Schema)`, мутации с `idempotencyKey`
  (`IdempotencyService.run`). Ошибки только `throw new AppError(ErrorCode.X, HttpStatus.Y)`.
- Мутация игрока: `prisma.transaction` → `lockPlayer(tx, userId)` → проводки `ledger.post(tx, …,
  { seasonId })` → обновление строк. Баланс напрямую не менять.
- Числа экономики только из `GameConfigService.active()`; флаги из `FlagsService.isEnabled`.
- Prisma-клиент генерируется в `src/generated/prisma/` (в .gitignore); импорт
  `../generated/prisma/client.js`. Пути импорта с `.js` (ESM).
- Новый `*-cli.ts` в `src/ops/` регистрировать сервис в `src/ops/ops.module.ts`; на проде запуск
  `node dist/ops/<name>-cli.js`, без `--confirm` только подсчёт.

## Команды (из корня, всё в Docker)

- `make check P=apps/api` — eslint + prettier + typecheck + vitest (dot), хвост 40 строк.
- Один файл: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm
  --no-deps -w /app/apps/api tools pnpm exec vitest run test/me.test.ts --reporter=dot`
  (сначала `docker compose … up -d --wait postgres redis`).
- `make migrate` после правки `prisma/schema.prisma`; новая миграция, старые не править.

## Частые ошибки (уже были)

- В тестах числа брать из активного конфига: `test/support/global-setup.ts` меняет стартовые
  деньги (500 000 коп.), медали и т. п. `DEFAULT_GAME_CONFIG` с тестовой БД не совпадает.
- `patchFlags(t, …)` и подмена `configs.active` живут до конца файла: ставить в конце или
  восстанавливать в `finally`.
- Параллельные тест-файлы делят БД: не делать глобальных выборок «все игроки US» и т. п., ограничивать
  своими `userId`. Игроков, чей порядок важен, создавать последовательно (не `Promise.all`).
- Запросы медалей и счётчиков фильтровать `season_id` текущего сезона (D-151).
- Стартовый холдер `basic` неявный (D-150): не удалять его строки при сбросах.
- Пересборка рейтинга должна сохранять hash `…:reached` (D-154).
- Telegram `getChatMember` для отсутствующего отвечает ошибкой `PARTICIPANT_ID_INVALID` (D-153):
  это «не подписан».
- Сохранённый конфиг читается через `parseConfig` с подстановкой `DEFAULT_GAME_CONFIG`: необязательный
  раздел в старой версии всё равно есть. Закрывать фичу флагом, не отсутствием раздела (D-169).

## Согласовывать

- `packages/shared` (типы, схема конфига, ошибки, i18n) — меняет и клиенты; после правки
  `make typecheck` всего репо.
- `prisma/schema.prisma` и любые данные прода; конфиг прода — только новой версией (см. STATUS.md).
