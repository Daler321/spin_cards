import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.js';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'req.headers["x-telegram-init-data"]',
];

export function pinoParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: REDACTED_PATHS,
      customProps: (req: IncomingMessage) => ({ request_id: req.id }),
      autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false },
      ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
    },
  };
}
