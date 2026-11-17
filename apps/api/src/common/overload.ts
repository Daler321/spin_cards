import { monitorEventLoopDelay } from 'node:perf_hooks';
import { type ApiErrorBody, ErrorCode } from '@spincards/shared';
import type { FastifyInstance } from 'fastify';

export interface OverloadLimits {
  /** Requests being handled by this process at once. */
  maxInFlight: number;
  /** Event-loop delay (p99 over the last second) above which new requests are turned away. */
  maxLagMs: number;
}

/** Health checks must keep answering while the process sheds load. */
const EXEMPT = /^\/health(\?|$)/;

/**
 * Load shedding (D-118): when the process is saturated, new requests get `503 OVERLOADED` before
 * any work is done, so the client may resend them as they are (mutations keep their idempotency
 * key). Better a quick retry than a queue where every request waits seconds.
 */
export function installOverloadGuard(fastify: FastifyInstance, limits: OverloadLimits): () => void {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let lagMs = 0;
  const sampler = setInterval(() => {
    lagMs = delay.percentile(99) / 1e6;
    delay.reset();
  }, 1000);
  sampler.unref();

  let inFlight = 0;
  const body: ApiErrorBody = { error: { code: ErrorCode.OVERLOADED, requestId: '' } };

  fastify.addHook('onRequest', (request, reply, done) => {
    if (EXEMPT.test(request.url)) {
      done();
      return;
    }
    if (inFlight >= limits.maxInFlight || lagMs > limits.maxLagMs) {
      void reply
        .status(503)
        .header('retry-after', '1')
        .send({ error: { ...body.error, requestId: request.id } });
      return;
    }
    inFlight++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    };
    reply.raw.once('finish', release);
    reply.raw.once('close', release);
    done();
  });

  return () => {
    clearInterval(sampler);
    delay.disable();
  };
}
