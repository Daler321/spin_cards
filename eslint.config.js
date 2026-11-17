import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist', '**/coverage', '**/node_modules', 'apps/api/src/generated']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'apps/*/vite.config.ts',
            'apps/web/vitest.config.ts',
            'apps/admin/vitest.config.ts',
            'apps/*/scripts/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-console': ['error', { allow: ['error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    ignores: ['**/vite.config.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'error',
    },
  },
  {
    // NestJS DI reads constructor parameter types at runtime, so they must stay value imports.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/web/**', 'apps/admin/**', 'apps/bot/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@spincards/api', '**/apps/api/**'], message: 'Talk to api over HTTP.' },
            { group: ['@prisma/*', 'pg', 'ioredis'], message: 'No direct DB/Redis access.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/game-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'net', 'http', 'crypto'], message: 'game-core has no I/O.' },
            {
              group: ['@spincards/api', '@spincards/web', '**/apps/**'],
              message: 'No app imports.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the injected Rng.' },
        { object: 'Date', property: 'now', message: 'Use the injected Clock.' },
      ],
      'no-restricted-syntax': [
        'error',
        // Building dates from values is fine; reading the current time is not.
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock.',
        },
      ],
    },
  },
  {
    // CLIs and build scripts print reports to stdout.
    files: ['packages/*/bin/**/*.ts', 'apps/*/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests index fixtures they just built; a missing entry fails the test anyway.
    files: ['**/test/**/*.ts', 'apps/*/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Typed HTTP helpers (`call<T>()`) name the expected response type only in the return type.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
