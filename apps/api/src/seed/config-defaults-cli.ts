/**
 * `make config-defaults`: makes the built-in default config the active version (after a release
 * that changed defaults). The new version is simulated first and activated only inside the RTP
 * corridor; the previous one is archived (roll back from the admin panel). Logged in audit_log.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_GAME_CONFIG } from '@spincards/shared';
import { DEFAULT_SIM_SPINS, runSimulation } from '../admin/admin-config.service.js';
import { loadEnv } from '../config/env.js';
import { ConfigStatus, type Prisma, PrismaClient } from '../generated/prisma/client.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const report = await runSimulation(DEFAULT_GAME_CONFIG, DEFAULT_SIM_SPINS);
  for (const item of report.items)
    process.stdout.write(
      `${item.packId} ${item.region} ${item.scenario}: RTP ${String((item.rtpBp ?? 0) / 100)}% ${item.inCorridor ? 'OK' : 'OUT'}\n`,
    );
  for (const game of report.minigames ?? [])
    process.stdout.write(
      `${game.game} ${game.difficulty ?? ''}: RTP ${String(game.minBp / 100)}–${String(game.maxBp / 100)}% ${game.inCorridor ? 'OK' : 'OUT'}\n`,
    );
  if (!report.ok) {
    process.stdout.write('defaults are outside the RTP corridor: nothing activated\n');
    process.exitCode = 1;
  } else {
    const id = await prisma.$transaction(async (tx) => {
      const previous = await tx.gameConfigVersion.findFirst({
        where: { status: ConfigStatus.active },
      });
      if (previous)
        await tx.gameConfigVersion.update({
          where: { id: previous.id },
          data: { status: ConfigStatus.archived },
        });
      const created = await tx.gameConfigVersion.create({
        data: {
          payload: DEFAULT_GAME_CONFIG,
          status: ConfigStatus.active,
          simulationReport: report as unknown as Prisma.InputJsonValue,
          comment: 'Built-in defaults (make config-defaults)',
          createdBy: 'system',
          activatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorId: 'config-defaults',
          action: 'config.activate',
          targetType: 'config',
          targetId: String(created.id),
          reason: 'Built-in defaults',
          payload: { previous: previous?.id ?? null },
        },
      });
      return created.id;
    });
    process.stdout.write(`config version ${String(id)} is active (applies within seconds)\n`);
  }
} finally {
  await prisma.$disconnect();
}
