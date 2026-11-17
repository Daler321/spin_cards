# SpinCards

Telegram Mini App: рулетка игровых банковских карт. Карта проекта: скилл [codebase-map](.claude/skills/codebase-map/SKILL.md), состояние:
[docs/STATUS.md](docs/STATUS.md), правила: [CLAUDE.md](CLAUDE.md), решения: [docs/decisions.md](docs/decisions.md),
история: [CHANGELOG.md](CHANGELOG.md). Исходное ТЗ в архиве: [docs/archive/TZ.md](docs/archive/TZ.md).

## Запуск с нуля

Нужны только **Docker** (с Compose v2.24+) и **make**. Node.js, Postgres и Redis на хост ставить не надо.

```sh
git clone <repo> spincards && cd spincards
make up
```

`make up` создаёт недостающие `.env` из `.env.example`, собирает dev-образы, ставит зависимости
в Docker-volume, поднимает все сервисы и ждёт, пока они станут healthy. Первый запуск занимает несколько минут.

| Что      | Адрес                                                 |
| -------- | ----------------------------------------------------- |
| Mini App | http://localhost:8080/                                |
| Админка  | http://localhost:8080/admin/                          |
| API      | http://localhost:8080/api/health, `/api/health/ready` |

Порт меняется переменной `PROXY_PORT` в `infra/.env`.

### Бот

1. Создайте бота в [@BotFather](https://t.me/BotFather) и впишите токен в `apps/bot/.env` (`BOT_TOKEN=...`)
   и тот же токен в `apps/api/.env` (`TELEGRAM_BOT_TOKEN=...`): api проверяет им подпись входа из Mini App.
2. `make restart s=bot` (пересоздаёт контейнер, чтобы он перечитал `.env`), затем отправьте боту `/start`.

Без токена бот работает в режиме ожидания: остальной стек от этого не зависит.

Бот ходит в api только через внутренние маршруты `/internal/bot/*` с общим секретом
`INTERNAL_API_TOKEN` (генерируется `make env` в `infra/.env`); снаружи через proxy они недоступны.
Команды: `/start` (с реферальным параметром `ref_<код>`), `/help`, `/rules`, `/settings`.

Уведомления (бесплатный прокрут готов, карта скоро сгорит, награда реферала, возвращение после
3 суток, рассылки) worker раз в минуту кладёт в `notifications_outbox`, бот забирает и отправляет
их с учётом настроек игрока, тихих часов 23:00–09:00 по часовому поясу региона, лимита 3 в сутки
и скорости не больше 25 сообщений в секунду. `NOTIFY_ENABLED=false` в `apps/bot/.env` оставляет
команды работать, а уведомления ждут в очереди. Рассылка до появления админки:
`make broadcast TEXT="…" SEGMENT=all|active|inactive DAYS=7`.

В dev бот работает через long polling. В production (`BOT_MODE=webhook`, включён в
`docker-compose.prod.yml`) Telegram присылает обновления на `PUBLIC_URL/bot/webhook`, бот проверяет
заголовок с `BOT_WEBHOOK_SECRET`. Оплата Stars заготовлена и выключена флагом `stars_enabled`.

### Админка

1. В `apps/api/.env` впишите `ADMIN_OWNER_LOGIN` и `ADMIN_OWNER_PASSWORD`, затем `make restart s=api`
   и `make seed`: сид создаст владельца (существующих не трогает).
2. Откройте http://localhost:8080/admin/ (или `PUBLIC_URL/admin/`), войдите и добавьте ключ в
   приложение-аутентификатор (Google Authenticator, 1Password, Aegis): ключ показывается один раз.
3. После входа пароль из `.env` можно удалить. `ADMIN_SECRET_KEY` шифрует ключи TOTP: не меняйте его,
   иначе админам придётся настраивать TOTP заново.

### Открыть Mini App из Telegram (HTTPS-туннель)

Telegram открывает Mini App только по HTTPS. По умолчанию используется **ngrok**: в бесплатном аккаунте
есть один постоянный домен, поэтому адрес в BotFather не придётся менять после перезапусков.

1. Зарегистрируйтесь на [dashboard.ngrok.com](https://dashboard.ngrok.com). В `infra/.env` впишите
   `NGROK_AUTHTOKEN` (страница _Your Authtoken_) и `NGROK_DOMAIN` (страница _Domains_, бесплатный
   статический домен вида `xxx.ngrok-free.app`).
2. `make tunnel` печатает HTTPS-адрес.
3. Впишите его в `infra/.env` → `PUBLIC_URL=https://...` и выполните `make restart s=bot`
   (у бота появится кнопка «Играть»).
4. В @BotFather: _Bot Settings → Configure Mini App_ (или _Menu Button_) укажите тот же адрес.

Остановить туннель: `make tunnel-down`.

На бесплатном плане ngrok при первом открытии в браузере может показать страницу-предупреждение
(«You are about to visit…»), её достаточно подтвердить один раз.

Другие варианты:

| Вариант                 | Команда                             | Особенности                                                                                                                                |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Quick Tunnel | `make tunnel TUNNEL=cloudflared`    | без регистрации, но адрес меняется при каждом запуске                                                                                      |
| Тестовая среда Telegram | —                                   | отдельный бот в test DC; Mini App можно открыть по HTTP без TLS ([документация](https://core.telegram.org/bots/webapps#testing-mini-apps)) |
| Свой домен              | `SITE_ADDRESS=домен` в `infra/.env` | Caddy сам выпустит сертификат (этап M9)                                                                                                    |

## Команды

```
make up / down / restart / ps / logs   dev-стек (logs и restart принимают s=<service>;
                                       restart пересоздаёт контейнер и перечитывает .env)
make migrate / seed                    миграции и сиды (api выполняет их сам при старте)
make ledger-verify                     сверка: каждый баланс равен сумме записей ledger
make broadcast TEXT="…" SEGMENT=all    рассылка через бота (SEGMENT=active|inactive и DAYS=N)
make stats DATE=2026-10-13             пересчитать и показать метрики дня (по умолчанию сегодня)
make load-spin ARGS="…"                нагрузочный тест /v1/spin на тестовой БД (--users 50 --seconds 30,
                                       --processes 4 — api кластером, как в проде)
make test / lint / typecheck / format  проверки в контейнере tools (тесты api используют БД spincards_test)
make e2e                               Playwright smoke Mini App против запущенного dev-стека
make backup / restore-check            дамп dev-базы / проверка восстановления последнего дампа
make build                             сборка всех пакетов
make sim ARGS="…"                      симулятор экономики, напр. ARGS="--pack basic --spins 1000000"
make progression ARGS="…"              прогрессия за сезон по типам игроков (уровень, деньги, пакеты)
make tunnel / tunnel-down              HTTPS-туннель (ngrok; TUNNEL=cloudflared — без аккаунта)
make prod-build / prod-up / prod-down  production-образы локально
make release / ship HOST=user@server   выкладка на VPS без сборки на сервере (docs/deploy.md)
make clean                             остановить всё и удалить volumes (БД, node_modules)
```

Для IDE можно поставить зависимости и на хост (`corepack enable && pnpm install`, Node 24): контейнеры
используют свои `node_modules` в volume и с хостовыми не пересекаются. Точечные команды:
`pnpm --filter @spincards/<app> <script>`.

## Структура

```
apps/api           NestJS (Fastify): REST API и worker (BullMQ)
apps/web           Mini App: React + Vite
apps/admin         админка: React + Vite (base /admin/)
apps/bot           Telegram-бот: grammY
packages/shared    типы, коды ошибок, i18n-ресурсы
packages/game-core чистая игровая логика и симулятор (без I/O)
infra              docker-compose, Caddy, .env.example для compose
```

## Окружение

| Файл                               | Что там                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `infra/.env`                       | порт proxy, адрес сайта Caddy, учётка Postgres, `PUBLIC_URL`, `INTERNAL_API_TOKEN` |
| `apps/api/.env`                    | `NODE_ENV`, порты, уровень логов, CORS, `DEV_AUTH_BYPASS` (только development)     |
| `apps/bot/.env`                    | `BOT_TOKEN`, `BOT_MODE`, `BOT_WEBHOOK_SECRET`, `NOTIFY_ENABLED`                    |
| `apps/web/.env`, `apps/admin/.env` | `VITE_*` (попадают в браузер, без секретов)                                        |

`DATABASE_URL` и `REDIS_URL` собирает compose. Реальные `.env` не коммитятся.

## Отладка в браузере без Telegram

1. В `apps/api/.env` поставьте `DEV_AUTH_BYPASS=true`, в `apps/web/.env` — `VITE_DEV_AUTH=true`.
2. `make restart s=api` и `make restart s=web`, откройте http://localhost:8080/.

Mini App войдёт мок-пользователем через `POST /api/v1/auth/dev`. В production api с этим флагом
не запустится. Галерея всех вариантов карты для оценки дизайна: http://localhost:8080/#gallery (только dev).

## Как устроен dev-режим

- Исходники монтируются в контейнеры, `node_modules` (Linux) лежат в именованных volume.
  Одноразовый сервис `deps` выполняет `pnpm install --frozen-lockfile` перед стартом приложений.
- api, worker и bot перезапускаются через `node --watch`, web и admin работают через Vite HMR.
- После изменения зависимостей (`package.json`, `pnpm-lock.yaml`) выполните `make up`.
- Если volume с зависимостями сломались: `make clean && make up` (удалит и данные БД).
