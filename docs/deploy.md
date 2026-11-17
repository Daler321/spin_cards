# Выкладка на VPS

Образы собираются на машине разработчика и загружаются на сервер по SSH. На сервере нет исходников
и сборки: только папка `/opt/spincards` с `compose.yml`, `Caddyfile`, `spincards.sh`, `.env` и
загруженными образами.

## Что нужно

- VPS: Ubuntu 24.04, 4 vCPU, 8 ГБ RAM, 80 ГБ NVMe (минимум 2 vCPU / 4 ГБ: тогда уменьши лимиты
  памяти в `.env` вдвое). Локация за пределами РФ, чтобы бот достучался до Telegram.
- Домен с A-записью на IP сервера (например, `game.example.com`). Сертификат HTTPS Caddy получит сам.
- SSH-доступ по ключу.
- Docker Desktop на машине разработчика (собирает образы под `linux/amd64`).

## 1. Подготовка сервера (один раз)

```sh
ssh root@SERVER
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh          # Docker Engine + compose plugin
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Порты Postgres, Redis и сервисов наружу не открываются: всё ходит через Caddy на 80/443.

## 2. Первый релиз

На машине разработчика (всё закоммичено):

```sh
make release                         # образы spincards-{api,bot,web,admin}:<коммит> под linux/amd64
make ship HOST=root@SERVER           # копирует папку deploy/ и образы (~200 МБ), запускает
```

Первый `ship` загрузит образы и остановится: на сервере ещё нет `.env`. Создай его и запусти:

```sh
ssh root@SERVER
cd /opt/spincards
./spincards.sh init game.example.com   # .env с сгенерированными паролями и секретами
nano .env                              # TELEGRAM_BOT_TOKEN, ADMIN_OWNER_PASSWORD
./spincards.sh deploy                  # последний загруженный релиз
```

При старте api применяет миграции и сиды, создаёт аккаунт владельца админки; бот ставит вебхук на
`https://<домен>/bot/webhook`. После первого входа в админку (`https://<домен>/admin/`, TOTP)
удали `ADMIN_OWNER_PASSWORD` из `.env`.

В @BotFather: Bot Settings → Configure Mini App → URL `https://<домен>`.

## 3. Обновление

```sh
make release && make ship HOST=root@SERVER
```

После успешного `deploy` старые образы удаляются сами. На сервере остаются текущий и прошлый релиз
(для `rollback`), на машине разработчика — только что выложенный; dev-образы `:latest` не трогаются.
Если релиз не поднялся, ничего не удаляется.

`deploy` ждёт, пока все сервисы станут здоровыми. Если релиз не поднялся, скрипт покажет логи.
Вернуть прошлую версию: `ssh root@SERVER /opt/spincards/spincards.sh rollback`. Откат возвращает
только код: миграции базы не откатываются, поэтому миграции пишутся совместимыми с прошлой версией.

## Команды на сервере

```sh
cd /opt/spincards
./spincards.sh ps                 # статус
./spincards.sh logs api           # логи (api, worker, bot, proxy, postgres…)
./spincards.sh restart bot
./spincards.sh rollback
./spincards.sh prune              # удалить образы старых релизов вручную (deploy делает это сам)
```

Логи Docker ротируются (5 файлов по 10 МБ на сервис). У каждого сервиса лимит памяти, чтобы один
не уронил остальные; размеры в `.env`.

## Бэкапы

Worker каждый день в 03:00 UTC делает дамп базы в `/opt/spincards/backups/daily` (хранятся 7 дней,
воскресные ещё 4 недели в `weekly`) и по воскресеньям проверяет, что свежий дамп восстанавливается
и балансы в нём сходятся с ledger. Статус и список файлов: админка → Настройки → Алерты и бэкапы.

```sh
./spincards.sh backup                                    # дамп прямо сейчас (backups/manual)
./spincards.sh restore-check                             # проверить восстановление
./spincards.sh restore backups/daily/spincards-….dump    # заменить базу дампом (игра на это время стоит)
```

Перед восстановлением автоматически снимается страховочный дамп текущей базы (`backups/manual`,
`…-pre-restore.dump`). Пока дампы лежат на том же сервере: периодически скачивай их к себе
(`scp -r root@SERVER:/opt/spincards/backups ./`) до настройки внешнего хранилища.

## Алерты

В админке → Настройки → Алерты и бэкапы укажи свой Telegram ID (узнать: @userinfobot), напиши боту
`/start` и нажми «Отправить тестовый алерт». Бот сообщит, если упал сервис, не сделан бэкап, много
ошибок сервера, кончается диск или сработал предохранитель. Если упадёт весь сервер, алертов не
будет: добавь бесплатную проверку `https://<домен>/api/health` в UptimeRobot.

## Если сервер на ARM

`make release PLATFORM=linux/arm64`.
