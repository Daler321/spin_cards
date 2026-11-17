import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';
import { READINESS_CHECKS, redisCheck, type ReadinessChecks } from './readiness.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_CHECKS,
      inject: [PrismaService, REDIS],
      useFactory: (prisma: PrismaService, redis: Redis): ReadinessChecks => ({
        postgres: async () => {
          await prisma.$queryRaw`SELECT 1`;
        },
        redis: redisCheck(redis),
      }),
    },
  ],
})
export class HealthModule {}
