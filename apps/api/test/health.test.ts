import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { READINESS_CHECKS, type ReadinessChecks } from '../src/health/readiness.js';
import { createTestApp, type TestApp } from './support/app.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('GET /health is live without a token', async () => {
    const res = await t.app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready checks Postgres and Redis', async () => {
    const res = await t.app.inject({ url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('GET /health/ready returns 503 when a dependency fails', async () => {
    const checks = t.app.get<ReadinessChecks>(READINESS_CHECKS);
    const original = checks.redis!;
    checks.redis = () => Promise.reject(new Error('down'));
    const res = await t.app.inject({ url: '/health/ready' });
    checks.redis = original;
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'fail', checks: { postgres: 'ok', redis: 'fail' } });
  });

  it('unknown routes return an error code without details', async () => {
    const res = await t.app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(res.body).not.toMatch(/stack|Cannot GET/);
  });

  it('echoes a valid incoming request id and replaces a malformed one', async () => {
    const kept = await t.app.inject({ url: '/nope', headers: { 'x-request-id': 'abc-123' } });
    expect(kept.headers['x-request-id']).toBe('abc-123');
    expect(kept.json()).toMatchObject({ error: { requestId: 'abc-123' } });

    const replaced = await t.app.inject({ url: '/health', headers: { 'x-request-id': 'bad id!' } });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
