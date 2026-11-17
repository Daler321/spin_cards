import { createServer, type Server } from 'node:http';
import { webhookCallback } from 'grammy';
import { pino } from 'pino';
import { InternalApi } from './api.js';
import { ALLOWED_UPDATES, createBot, publishCommands } from './bot.js';
import { loadEnv } from './env.js';
import { startHealthServer } from './health.js';
import { createBotTexts } from './i18n.js';
import { Notifier } from './notifier.js';

const WEBHOOK_PATH = '/bot/webhook';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'bot' },
    ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
  });
  const texts = await createBotTexts();
  const translator = texts.translator;

  if (!env.BOT_TOKEN) {
    logger.warn('BOT_TOKEN is empty: bot stays idle. Set it in apps/bot/.env and restart.');
    const health = startHealthServer(env.BOT_HEALTH_PORT, () => true);
    const exit = () => {
      health.close();
      process.exit(0);
    };
    process.once('SIGTERM', exit);
    process.once('SIGINT', exit);
    return;
  }
  if (!env.INTERNAL_API_TOKEN) logger.warn('INTERNAL_API_TOKEN is empty: api calls will fail');

  const api = new InternalApi(env.API_INTERNAL_URL, env.INTERNAL_API_TOKEN);
  // D-134: owner-edited texts, refreshed every minute (the api is the only source).
  const syncTexts = () =>
    api
      .texts()
      .then(texts.apply)
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'texts not refreshed');
      });
  await syncTexts();
  const textTimer = setInterval(() => void syncTexts(), 60_000);
  textTimer.unref();

  const bot = createBot({
    token: env.BOT_TOKEN,
    api,
    translator,
    publicUrl: env.PUBLIC_URL,
    logger,
    startLink: texts.startLink,
    options: texts.options,
  });
  await bot.init();
  await publishCommands(bot, translator()).catch((error: unknown) => {
    logger.warn({ err: error }, 'commands not published');
  });

  const notifier = new Notifier({
    api,
    telegram: bot.api,
    translator,
    publicUrl: env.PUBLIC_URL,
    pollMs: env.NOTIFY_POLL_MS,
    logger,
    kinds: env.NOTIFY_KINDS,
  });

  let webhookServer: Server | null = null;
  let ready = false;
  const health = startHealthServer(env.BOT_HEALTH_PORT, () =>
    env.BOT_MODE === 'webhook' ? ready : bot.isRunning(),
  );

  // The open servers would keep the process alive after stopping (node --watch then hangs on
  // restart), so shutdown closes everything and exits.
  const stop = (): void => {
    logger.info('bot shutting down');
    health.close();
    webhookServer?.close();
    void Promise.allSettled([
      notifier.stop(),
      bot.isRunning() ? bot.stop() : Promise.resolve(),
    ]).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  if (env.NOTIFY_ENABLED) {
    notifier.start();
    if (env.NOTIFY_KINDS.length > 0)
      logger.info({ kinds: env.NOTIFY_KINDS }, 'delivering only these notifications');
  } else logger.warn('NOTIFY_ENABLED=false: notifications stay in the outbox');

  if (env.BOT_MODE === 'webhook') {
    if (!env.PUBLIC_URL.startsWith('https://'))
      throw new Error('webhook mode needs an HTTPS PUBLIC_URL');
    const handle = webhookCallback(bot, 'http', { secretToken: env.BOT_WEBHOOK_SECRET });
    webhookServer = createServer((req, res) => {
      if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
        void handle(req, res);
        return;
      }
      res.writeHead(404).end();
    }).listen(env.BOT_WEBHOOK_PORT, '0.0.0.0');
    await bot.api.setWebhook(env.PUBLIC_URL + WEBHOOK_PATH, {
      secret_token: env.BOT_WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    ready = true;
    logger.info({ username: bot.botInfo.username }, 'webhook set');
    return;
  }

  await bot.api.deleteWebhook();
  await bot.start({
    drop_pending_updates: env.NODE_ENV === 'development',
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: (me) => {
      logger.info({ username: me.username }, 'polling started');
    },
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
