import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { installOverloadGuard, type OverloadLimits } from './overload.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

/** Reuses a well-formed upstream request id (e.g. from the proxy), otherwise generates one. */
export function requestIdFor(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * Fastify assigns the id (pino-http reuses it via req.id) and echoes it in the response; with
 * `overload` set, saturated processes shed new requests (D-118).
 */
export function createHttpAdapter(overload?: OverloadLimits): FastifyAdapter {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    requestIdHeader: false,
    genReqId: requestIdFor,
  });
  adapter.getInstance().addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  if (overload) {
    const stop = installOverloadGuard(adapter.getInstance(), overload);
    adapter.getInstance().addHook('onClose', (_instance, done) => {
      stop();
      done();
    });
  }
  return adapter;
}
