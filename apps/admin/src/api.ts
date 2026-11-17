import { type ErrorCode, isErrorCode } from '@spincards/shared';

const BASE = `${import.meta.env.VITE_API_URL ?? '/api'}/admin`;

export class AdminApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly status: number,
  ) {
    super(code);
  }
}

/**
 * Admin API: the session lives in an httpOnly cookie; every request sends the CSRF header the
 * server requires on mutations.
 */
export async function adminApi<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'x-admin-request': '1',
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new AdminApiError('NETWORK', 0);
  }
  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    throw new AdminApiError(isErrorCode(code) ? code : 'INTERNAL_ERROR', response.status);
  }
  return json as T;
}

export const post = <T>(path: string, body: unknown = {}) =>
  adminApi<T>(path, { method: 'POST', body });

export function newKey(): string {
  return crypto.randomUUID();
}
