---
name: codebase-map
description: Где в SpinCards лежит код для типовых задач. Используй, когда нужно найти место для изменения, прежде чем искать по репозиторию.
---

# Карта проекта SpinCards

Обновлено: 2026-10-30, крафт, магазин, доход альбома, бонус за ник, новое «Ещё» (D-170…D-177).

## Архитектура

- `apps/web` (Mini App) и `apps/admin` (админка) ходят только в `apps/api` по HTTP (`/api` за proxy).
- `apps/bot` (grammY) ходит в api через внутренний HTTP (`/internal`, токен `INTERNAL_API_TOKEN`).
- `apps/api` (NestFastify) — единственный, кто пишет в PostgreSQL (Prisma) и Redis (рейтинги, кэш
  подписки, rate limit). Тот же код запускается вторым процессом `worker` (`worker.ts`): джобы срока
  жизни карт, комиссии рефералов, уведомления, сезоны, статистика, бэкапы, антифрод.
- `packages/game-core` — чистая логика (номера, паттерны, удача, спин, симулятор), без I/O; api
  передаёт ей `rng`, `clock`, `uniquenessChecker`.
- `packages/shared` — типы API, zod-схема конфига и дефолтный конфиг, коды ошибок, i18n-тексты.
- `infra` — docker-compose (dev/prod), Caddy, скрипты релиза. Деплой: `docs/deploy.md`.

## apps/api

- `apps/api/src/main.ts` — HTTP-сервер; `apps/api/src/worker.ts` — воркер; модули в
  `apps/api/src/app.module.ts` и `apps/api/src/worker.module.ts`.
- `apps/api/prisma/schema.prisma` — схема БД (миграции в `apps/api/prisma/migrations/`).
- `apps/api/src/config/env.ts` — переменные окружения (zod), запрет `DEV_AUTH_BYPASS` в prod.
- `apps/api/src/auth/telegram-init-data.ts` — HMAC initData; `apps/api/src/auth/users.service.ts` —
  регистрация, реферальный код, стартовые деньги; `apps/api/src/auth/dev-auth.controller.ts` — dev-вход.
- `apps/api/src/game/spin.service.ts` — прокрут (оплата, генерация, пул, near-miss, опыт, задания).
- `apps/api/src/game/cards.service.ts` — обналичить, оставить, пополнить, продлить, альбом карты.
- `apps/api/src/game/lifecycle.service.ts` — срок жизни, льготное окно, возврат в пул (джоба).
- `apps/api/src/game/bonus.service.ts` — сундук, колесо, награды дня; `apps/api/src/game/grant-reward.ts`.
- `apps/api/src/game/buffs.ts` — удача и бафы (D-147); `apps/api/src/game/card-view.ts` — ответ карты.
- `apps/api/src/game/quests.service.ts` — дневные/сезонные задания, канал (D-157), друзья (D-158).
- `apps/api/src/game/referral.service.ts` — награда за друга и комиссия (воркер).
- `apps/api/src/game/achievements.service.ts`, `apps/api/src/game/medals.ts` — медали.
- `apps/api/src/game/season-rollover.service.ts`, `apps/api/src/game/season-score.ts` — смена сезона.
- `apps/api/src/game/shop.service.ts` — холдеры, слоты альбома, покупки за монеты.
- `apps/api/src/minigames/` — мини-игры (D-169): раунды `mini_game_rounds`, ставки и выплаты через ledger.
- `apps/api/src/game/craft.service.ts` — крафт (D-170, `card_crafts`); `income.service.ts` + `income.ts` —
  доход альбома и бонус за ник (D-172, D-173); `nick-check.service.ts` — проверка имён (воркер).
- `apps/api/src/game/player-lock.ts` — `SELECT … FOR UPDATE` игрока; `crypto-rng.ts` — рандом.
- `apps/api/src/ledger/ledger.service.ts` — проводки; `apps/api/src/ledger/verify.ts` — сверка.
- `apps/api/src/idempotency/idempotency.service.ts` — idempotencyKey для мутаций.
- `apps/api/src/wallet/conversion.service.ts`, `p2p.service.ts`, `exchange-rate.service.ts`.
- `apps/api/src/game-config/game-config.service.ts` — активный конфиг; `flags.service.ts` — флаги;
  `season.service.ts` — текущий сезон.
- `apps/api/src/me/me.controller.ts` — `/v1/me`, регион; `public-config.controller.ts` — публичный конфиг.
- `apps/api/src/leaderboard/leaderboard.service.ts` — рейтинги в Redis (D-154).
- `apps/api/src/notifications/` — outbox уведомлений, расписание, рассылки (`broadcast-cli.ts`).
- `apps/api/src/payments/payments.service.ts` — Stars; `telegram-api.service.ts` — Bot API из api.
- `apps/api/src/subscription/subscription.service.ts`, `subscription.guard.ts` — подписка на канал.
- `apps/api/src/social/` — профили игроков, альбом коллекции; `apps/api/src/share/` — картинки карт.
- `apps/api/src/analytics/` — события, `daily-stats.service.ts`, метрики админки.
- `apps/api/src/antifraud/antifraud.service.ts` — сигналы; `apps/api/src/safeguards/` — пауза пакетов по RTP.
- `apps/api/src/admin/` — админка: auth+TOTP, конфиг (`admin-config.service.ts`), игроки, ops.
- `apps/api/src/texts/texts.service.ts` — правки текстов Mini App из админки (D-134).
- `apps/api/src/ops/` — бэкапы, алерты, CLI: `season-launch-cli.ts`, `achievement-revoke-cli.ts`,
  `region-merge-cli.ts`, `season-rename-cli.ts`.
- `apps/api/src/seed/seed.ts` — банки, флаги, курсы; `config-defaults-cli.ts` — активация дефолтов.
- `apps/api/src/common/` — `app-error.ts`, `error.filter.ts`, `zod.pipe.ts`, `logger.ts`, `money.ts`.
- `apps/api/test/` — интеграционные тесты, `apps/api/test/support/` — `createTestApp`, `login`, `fund`.
- `apps/api/scripts/load-spin.ts` — нагрузочный тест `/spin`.

## apps/web

- `apps/web/src/app/App.tsx` — оболочка, вкладки, подписка, обучение; `telegram.ts` — WebApp, haptics.
- `apps/web/src/api/client.ts` — fetch, токены, повтор с тем же ключом; `queries.ts` — все хуки.
- `apps/web/src/screens/RouletteScreen.tsx` — главная (прокрут); остальные экраны в `apps/web/src/screens/`.
- `apps/web/src/components/ResultPanel.tsx` — экран результата; `Reveal.tsx` — анимация прокрута
  (все карты сразу, цифры по одной, один rAF; тайминги в `lib/reveal.ts`, D-164).
- `apps/web/src/components/card/Card.tsx`, `banks.tsx`, `card.css` — карта и стили банков;
  `card-emerald.css` — дизайн сезона «emerald» поверх `card.css` (D-168).
- `apps/web/src/lib/useCardDesign.ts` — дизайн карт текущего сезона (контекст из публичного конфига).
- `apps/web/src/components/SpinOptions.tsx` — ряд над «Крутить»: валюта (`RegionToggle.tsx`), пакет,
  ×N, оплата (`PaymentSheet.tsx`); `Controls.tsx` — пикеры в шторках, шкалы, плашка сундучка;
  `LuckChip.tsx` — удача (в шапке).
- `apps/web/src/lib/spinSetup.ts` — что сделает «Крутить» (пакет, карта, количество): общий для главной и шапки.
- `apps/web/src/components/WalletTopup.tsx` — перевод карта → кошелёк; `WalletPrompt.tsx` +
  `lib/useWalletGuard.ts` — «пополните кошелёк» перед покупкой (D-166).
- `apps/web/src/components/Quests.tsx` — задания; `CoachHint.tsx` — подсказки новичкам (D-155);
  `InviteBanner.tsx` — «Позови друга» (от 200 прокрутов); `Header.tsx` — уровень, баланс, удача, подарок;
  `Onboarding.tsx` — слайды; `TabBar.tsx` — иконки, вкладка «Ещё» (`MoreScreen.tsx` → кошелёк, плитки мини-игр).
- `apps/web/src/lib/` — форматирование, деньги, пакеты, удача, `tutorial.ts`, `referral.ts`.
- `apps/web/src/state/` — zustand: навигация, выбор, UI, тосты, сессия.
- `apps/web/src/styles.css` — все стили (своя палитра D-168, `@font-face` PT Serif из `src/assets/fonts`).
- `apps/web/test/` — vitest; `apps/web/e2e/` — Playwright smoke.

## apps/bot

- `apps/bot/src/main.ts` — запуск: polling или webhook (`BOT_MODE`), `health.ts` — health-сервер.
- `apps/bot/src/bot.ts` — `createBot`: команды (/start с реферальным payload, /help, /rules, /settings,
  /ref, /support, /chatid), оплата Stars (`pre_checkout_query`, `successful_payment`), `channel_post`
  (задание канала), `my_chat_member`; `publishCommands` — меню команд.
- `apps/bot/src/start.ts` — `buildStartReply`: текст и кнопка ответа на /start.
- `apps/bot/src/notifier.ts` — цикл доставки outbox (claim у api, отправка, результат);
  `notify.ts` — текст уведомления (`renderNotification`), `RateLimiter`.
- `apps/bot/src/api.ts` — `InternalApi`, клиент `/internal/bot/*`; `apps/bot/src/env.ts` — env (zod).
- `apps/bot/src/i18n.ts` — тексты `bot.json` + правки владельца из админки (D-134).

## apps/admin

- `apps/admin/src/App.tsx` — оболочка и роутинг разделов; `apps/admin/src/sections.ts` — разделы и роли.
- `apps/admin/src/api.ts` — `adminApi`/`post` к `/api/admin`, `newKey` — idempotencyKey.
- `apps/admin/src/screens/` — Login, Dashboard, Configs/ConfigForm, Users, Flags, Seasons, Payments,
  Broadcasts, Texts, Settings (подписка на канал, D-110), Audit, Pool, Admins.
- `apps/admin/src/config-fields.ts` — поля формы конфига (подписи `cfg.*` в `admin.json`).
- `apps/admin/src/ui.tsx` — `Table`, `ReasonAction`; `format.ts` — деньги, даты, тексты ошибок;
  `i18n.ts` — неймспейсы `admin`, `common`, `errors`.
- Серверная часть админки — `apps/api/src/admin/` (контроллеры, `admin-users.service.ts`, TOTP).

## packages/game-core

- `packages/game-core/src/spin.ts` — один прокрут целиком; `packages/game-core/src/valuation.ts` — баланс карты.
- `packages/game-core/src/number/generate.ts`, `patterns.ts`, `luhn.ts` — номера и узоры.
- `packages/game-core/src/luck/` — удача, веса тиров, буст; `near-miss.ts`; `progress.ts` — уровни.
- `packages/game-core/src/quests.ts`, `achievements.ts` — логика заданий и медалей.
- `packages/game-core/src/minigames/` — минёр, плинко, монета, 21 и их возврат (`rtp.ts`).
- `packages/game-core/src/craft.ts` — крафт и карта заданного тира (`forgeCard`), возврат для симуляции.
- `packages/game-core/src/sim/simulate.ts` — симулятор RTP; `packages/game-core/src/ports.ts` — интерфейсы.
- `packages/game-core/test/` — детерминированные тесты с seed.

## packages/shared

- `packages/shared/src/game/config-schema.ts` — zod-схема конфига; `default-config.ts` — значения.
- `packages/shared/src/game/constants.ts` — тиры, регионы, валюты, `STARTER_HOLDER_ID`, `DEFAULT_REGION`.
- `packages/shared/src/api.ts` — типы API игрока; `admin.ts` — админки; `internal.ts` — бота.
- `packages/shared/src/errors.ts` — коды ошибок; `packages/shared/src/i18n/locales/ru/` — тексты.

## infra

- `infra/docker-compose.yml` + `infra/docker-compose.dev.yml` (dev, сервис `tools`) +
  `infra/docker-compose.prod.yml`; `infra/caddy/Caddyfile` — proxy.
- `infra/scripts/release.sh` — сборка образов `spincards-<app>:<коммит>`; `infra/scripts/ship.sh` —
  `docker save | ssh docker load`, деплой, затем удаление старых локальных образов релизов.
- `deploy/` — то, что копируется в `/opt/spincards` на сервер: `compose.yml` (прод-стек по `TAG`),
  `env.example`, `spincards.sh` (init, deploy, rollback, prune, backup/restore, config-defaults).
- `Makefile` — все команды.

## Хочу изменить → где искать

- Шансы тиров, веса узоров, цены пакетов, лимиты → `packages/shared/src/game/default-config.ts` (+ симулятор).
- Новое поле конфига → `config-schema.ts` + `default-config.ts` + `apps/admin/src/config-fields.ts`.
- Паттерны номеров → `packages/game-core/src/number/patterns.ts`, тесты `packages/game-core/test/patterns.test.ts`.
- Генерация номера, Луна, уникальность → `packages/game-core/src/number/generate.ts`, `spin.service.ts`.
- Логика прокрута, множитель, потолок → `packages/game-core/src/spin.ts`, `valuation.ts`.
- Удача, бафы, шкала удачи, pity → `packages/game-core/src/luck/`, `apps/api/src/game/buffs.ts`.
- Новичок и стартовая удача → `packages/game-core/src/luck/state.ts`, `spin.service.ts`.
- Near-miss → `packages/game-core/src/near-miss.ts`, флаг `near_miss_ux`.
- API прокрута → `apps/api/src/game/spin.service.ts`, `game.controller.ts`.
- Обналичить/оставить/пополнить/продлить → `apps/api/src/game/cards.service.ts`.
- Ledger, проводки → `apps/api/src/ledger/ledger.service.ts`; причины — enum `LedgerReason` в схеме.
- Пул карт, повторная выдача → `spin.service.ts` (`takeOldest`), `lifecycle.service.ts`.
- Срок жизни и джобы → `apps/api/src/game/lifecycle.service.ts`, расписание в `apps/api/src/worker.module.ts`.
- Холдеры, стартовые места → `apps/api/src/game/shop.service.ts`, `STARTER_HOLDER_ID`.
- Конвертация валют → `apps/api/src/wallet/conversion.service.ts`, курсы в `seed.ts`.
- Переводы игрокам → `apps/api/src/wallet/p2p.service.ts`, экран `WalletScreen.tsx`.
- Сундук, колесо, награды дня → `apps/api/src/game/bonus.service.ts`, `BonusesScreen.tsx`.
- Задания (дневные/сезонные/канал/друзья) → `apps/api/src/game/quests.service.ts`, `Quests.tsx`
  (`Quests` — экран `QuestsScreen.tsx` из «Бонусов», `SpecialQuests` — канал и друзья в «Бонусах»).
- Рефералка → `apps/api/src/game/referral.service.ts`, `apps/api/src/auth/users.service.ts`, `InviteBanner.tsx`.
- Медали → `apps/api/src/game/achievements.service.ts`, `packages/game-core/src/achievements.ts`.
- Рейтинги → `apps/api/src/leaderboard/leaderboard.service.ts`, `RatingScreen.tsx`.
- Сезоны: очки, итоги, смена, имя нового (`nextSeasonName`) → `season-rollover.service.ts`, `season-score.ts`, админка `Seasons.tsx`; переименовать текущий → `apps/api/src/ops/season-rename-cli.ts`.
- Профиль игрока, прокруты за сезон/всего → `apps/api/src/social/social.service.ts`, `ProfileScreen.tsx`, `RatingScreen.tsx` (`PlayerSheet`).
- Чистый старт всех игроков → `apps/api/src/ops/season-launch.ts`.
- Подписка на канал → `apps/api/src/subscription/`, `SubscribeScreen.tsx`, админка `Settings.tsx`.
- Stars → `apps/api/src/payments/payments.service.ts`, `StarsButton.tsx`, флаг `stars_enabled`.
- Флаги → `apps/api/src/game-config/flags.service.ts`, сид в `apps/api/src/seed/seed.ts`.
- Уведомления бота → `apps/api/src/notifications/notifications.service.ts`, `schedule.ts`, `apps/bot/src/notifier.ts`, текст — `apps/bot/src/notify.ts`.
- Рассылки → `apps/api/src/notifications/broadcast.service.ts`, админка `Broadcasts.tsx`.
- Тексты бота → `packages/shared/src/i18n/locales/ru/bot.json`, `apps/bot/src/i18n.ts`; правки из админки — `Texts.tsx`.
- Команды бота, Stars в боте → `apps/bot/src/bot.ts`; ответ на /start → `apps/bot/src/start.ts`.
- Разделы и роли админки → `apps/admin/src/sections.ts`, `App.tsx`.
- Главный экран → `apps/web/src/screens/RouletteScreen.tsx`, `SpinOptions.tsx`, `lib/spinSetup.ts`;
  кнопки «Перевести» и «Игры» вверху — `head-actions` в `RouletteScreen.tsx`.
- Кошелёк (вкладки перевода и обмена, история внизу, пополнение с карты) → `WalletScreen.tsx`, `WalletTopup.tsx`; быстрые суммы — `AMOUNT_STEPS` в `lib/money.ts`.
- Покупка с нехваткой на кошельке → `lib/useWalletGuard.ts` (`guard` перед мутацией), `WalletPrompt.tsx`.
- Размер рейтинга → `TOP` в `apps/api/src/leaderboard/leaderboard.service.ts` (50).
- Мини-игры → логика `packages/game-core/src/minigames/`, API `apps/api/src/minigames/`, конфиг `minigames`
  (+ проверка в `runSimulation`), флаг `minigames_enabled`; экран `MiniGameScreen.tsx`,
  `apps/web/src/components/minigames/`, плитки в `MoreScreen.tsx`.
- Экран результата → `apps/web/src/components/ResultPanel.tsx`.
- Крафт → `packages/game-core/src/craft.ts`, `craft.service.ts`, конфиг `craft`, флаг `craft_enabled`, `CraftScreen.tsx`.
- Улучшение карты за ⭐ → `card_upgrade` в `packages/shared/src/game/stars.ts`, `applyStarsCard` в `cards.service.ts`.
- Магазин (все покупки) → `ShopScreen.tsx`; колесо → `components/Wheel.tsx`, `WheelScreen.tsx`; «Ещё» → `MoreScreen.tsx`.
- Доход альбома, бонус за ник → `income.service.ts`, конфиг `albumIncome`/`nickBonus`, карточки в `BonusesScreen.tsx`.
- Автопродажа → `autoCashoutTiers` (настройки), `spin.service.ts`; собрать на одну → `cards.collect`, `CollectButton.tsx`.
- Профиль на вкладках → `ProfileScreen.tsx`, вкладка в `state/ui.ts`.
- «Ещё» (плитки, поиск) → `MoreScreen.tsx`; экраны из него: `MiniGamesScreen`, `ReferralsScreen`, `MedalsScreen`,
  `NickBonusScreen`, `SeasonsScreen` (`GET /v1/seasons`), `PlayerSearchScreen` (`GET /v1/players/by-username/:username`,
  карточка — `components/PlayerProfileView.tsx`, она же в рейтинге). Шапка → `components/Header.tsx` (только чтение).
- Компонент карты, стиль банков → `apps/web/src/components/card/`.
- Дизайн карт сезона, трофеи в альбоме → `CARD_DESIGNS` в `packages/shared/src/game/constants.ts`,
  `seasons.design_set_id`, `cards.design` (пишет `putInAlbum` в `cards.service.ts`), `card-<design>.css`.
- Анимация прокрута → `apps/web/src/components/Reveal.tsx`, `apps/web/src/lib/reveal.ts`.
- Подсказки и обучение → `apps/web/src/lib/tutorial.ts`, `CoachHint.tsx`, `Onboarding.tsx`.
- Тексты Mini App → `packages/shared/src/i18n/locales/ru/{common,game,shop,errors}.json`.
- Симулятор → `packages/game-core/src/sim/simulate.ts`, `make sim`, проверка в `admin-config.service.ts`.
- Метрики админки → `apps/api/src/analytics/daily-stats.service.ts`, `metrics.ts`, `Dashboard.tsx`.
- Антифрод → `apps/api/src/antifraud/antifraud.service.ts`.
- Профиль игрока в админке, ручные действия → `apps/api/src/admin/admin-users.service.ts`.
- Публичный конфиг для клиента → `apps/api/src/me/public-config.controller.ts`.
- Auth, токены → `apps/api/src/auth/`; rate limit → `apps/api/src/rate-limit/rate-limit.guard.ts`.
- Деплой, откат, очистка образов → `infra/scripts/ship.sh`, `deploy/spincards.sh`, `docs/deploy.md`; окружение → `apps/*/.env.example`, `infra/.env.example`.

## Сквозные вещи

- Типы и zod: общие типы только в `packages/shared/src/`; входы маршрутов через `ZodPipe`.
- Коды ошибок: `packages/shared/src/errors.ts` + ключ в `errors.json`; сервер бросает `AppError`.
- i18n: ключи в `packages/shared/src/i18n/locales/ru/`, клиент `apps/web/src/i18n.ts`; ICU plural.
- Конфиг экономики: версии в таблице `game_config_versions`, активация только после симуляции.
- Деньги: целые минимальные единицы (`bigint` в api, `number` в API-ответах), ledger в той же транзакции.
- Идемпотентность: `IdempotencyService.run` + `idempotencyKey` в теле запроса.
- Логи: pino через `apps/api/src/common/logger.ts`, `request_id`, без персональных данных.
