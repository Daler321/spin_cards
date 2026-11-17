import swc from 'unplugin-swc';
import { defineProject, type UserWorkspaceConfig } from 'vitest/config';

/**
 * Common setup of every Node test project. All of them compile TypeScript with SWC (NestJS needs
 * decorator metadata), so workspace sources are transformed identically everywhere and coverage
 * from different projects merges into one map.
 */
export function nodeProject(name: string, test: UserWorkspaceConfig['test'] = {}) {
  return defineProject({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    resolve: { conditions: ['@spincards/source'] },
    ssr: { resolve: { conditions: ['@spincards/source'] } },
    test: { name, include: ['test/**/*.test.ts'], environment: 'node', ...test },
  });
}
