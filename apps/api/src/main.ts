import 'reflect-metadata';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { createHttpAdapter } from './common/http-adapter.js';
import { type Env, loadEnv } from './config/env.js';

async function bootstrap(env: Env): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env),
    createHttpAdapter({
      maxInFlight: env.OVERLOAD_MAX_IN_FLIGHT,
      maxLagMs: env.OVERLOAD_MAX_LAG_MS,
    }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

/**
 * D-118: one Node process uses one core, so the api runs API_PROCESSES copies on the same port
 * (node:cluster balances connections). The primary only supervises: a crashed process is replaced,
 * SIGTERM is passed on for a graceful stop.
 */
function supervise(count: number): void {
  let stopping = false;
  const fork = () => cluster.fork();
  for (let i = 0; i < count; i++) fork();
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    // why: signal is '' or null depending on the Node version, so `||` rather than `??`.
    const reason = signal || String(code);
    console.error(`api process ${String(worker.process.pid)} exited (${reason}), restarting`);
    setTimeout(fork, 1000);
  });
  const stop = () => {
    stopping = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill('SIGTERM');
    setTimeout(() => process.exit(0), 15_000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

const env = loadEnv();
const processes = env.API_PROCESSES === 'auto' ? availableParallelism() : env.API_PROCESSES;

if (cluster.isPrimary && processes > 1) {
  supervise(processes);
} else {
  bootstrap(env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
