import { describe, expect, it } from 'vitest';
import { ErrorCode, isErrorCode, NAMESPACES, resolveLanguage, resources } from '../src/index.js';

function leaves(obj: object, prefix = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([key, value]: [string, unknown]) =>
    typeof value === 'object' && value !== null
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value] as [string, unknown]],
  );
}

describe('i18n resources', () => {
  it('has every namespace for every language', () => {
    for (const lang of Object.values(resources)) {
      expect(Object.keys(lang).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it('translates every error code', () => {
    for (const lang of Object.values(resources)) {
      expect(Object.keys(lang.errors).sort()).toEqual(Object.values(ErrorCode).sort());
    }
  });

  it('has no empty strings', () => {
    for (const lang of Object.values(resources)) {
      for (const ns of Object.values(lang)) {
        for (const [key, value] of leaves(ns)) {
          expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
        }
      }
    }
  });
});

describe('error codes', () => {
  it('uses the key as the value', () => {
    for (const [key, value] of Object.entries(ErrorCode)) expect(value).toBe(key);
  });

  it('recognises known codes only', () => {
    expect(isErrorCode('INSUFFICIENT_FUNDS')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe('resolveLanguage', () => {
  it('falls back to ru', () => {
    expect(resolveLanguage(undefined)).toBe('ru');
    expect(resolveLanguage('en-US')).toBe('ru');
    expect(resolveLanguage('RU')).toBe('ru');
  });
});
