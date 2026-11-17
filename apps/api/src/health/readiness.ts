import type { Redis } from 'ioredis';

export type ReadinessCheck = () => Promise<void>;
export type ReadinessChecks = Record<string, ReadinessCheck>;

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

export function redisCheck(redis: Redis): ReadinessCheck {
  return async () => {
    await redis.ping();
  };
}
