import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/api', 'apps/bot', 'apps/web', 'apps/admin'],
    // Docker Desktop often has ~4 GB: one worker per core gets test workers OOM-killed.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      reporter: ['text-summary', 'html'],
      // CLAUDE.md: game-core coverage must stay >= 90%.
      thresholds: {
        'packages/game-core/src/**': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
});
