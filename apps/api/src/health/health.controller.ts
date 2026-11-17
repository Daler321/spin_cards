import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators.js';
import { READINESS_CHECKS, type ReadinessChecks } from './readiness.js';

type CheckStatus = 'ok' | 'fail';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_CHECKS) private readonly checks: ReadinessChecks) {}

  /** Liveness: the process is up and serving HTTP. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. */
  @Get('ready')
  async ready(@Res() reply: FastifyReply): Promise<void> {
    const entries = await Promise.all(
      Object.entries(this.checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
        try {
          await check();
          return [name, 'ok'];
        } catch {
          return [name, 'fail'];
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const healthy = entries.every(([, status]) => status === 'ok');
    void reply
      .status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .send({ status: healthy ? 'ok' : 'fail', checks });
  }
}
