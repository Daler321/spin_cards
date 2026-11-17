import { type ErrorCode, isErrorCode, type IssuedTokens } from '@spincards/shared';
import { telegramInitData } from '../app/telegram';
import { useSession } from '../state/session';

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const NETWORK_RETRIES = 2;
/** 503 OVERLOADED: the server did nothing, so any request may be resent as is (D-118). */
const OVERLOAD_RETRIES = 3;

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'NOT_IN_TELEGRAM';

/** Server errors carry only a code; the UI translates it via the `errors` namespace. */
export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Safe to resend after a network failure (GETs, and mutations carrying an idempotency key). */
  retryOnNetworkError?: boolean;
  auth?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const retries = (options.retryOnNetworkError ?? method === 'GET') ? NETWORK_RETRIES : 0;

  for (let attempt = 0, overloaded = 0, refreshed = false; ; attempt++) {
    let response: Response;
    try {
      const token = useSession.getState().tokens?.accessToken;
      response = await fetch(BASE + path, {
        method,
        headers: {
          ...(body !== undefined && { 'content-type': 'application/json' }),
          ...(auth && token && { authorization: `Bearer ${token}` }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw new ApiError('NETWORK', 0);
    }

    if (response.status === 401 && auth && !refreshed) {
      refreshed = true;
      if (await renewSession()) continue;
    }
    if (response.status === 204) return undefined as T;
    const json = (await response.json().catch(() => null)) as unknown;
    if (
      response.status === 503 &&
      errorCodeOf(json) === 'OVERLOADED' &&
      overloaded < OVERLOAD_RETRIES
    ) {
      overloaded++;
      await sleep(500 * 2 ** (overloaded - 1) + Math.random() * 300);
      continue;
    }
    if (!response.ok) throw new ApiError(errorCodeOf(json), response.status);
    return json as T;
  }
}

function errorCodeOf(json: unknown): ErrorCode {
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
  return isErrorCode(code) ? code : 'INTERNAL_ERROR';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Signs in: Telegram initData in the Mini App, or the dev mock login in a browser (dev only). */
export async function signIn(): Promise<void> {
  const initData = telegramInitData();
  let tokens: IssuedTokens;
  if (initData) {
    tokens = await api<IssuedTokens>('/v1/auth/telegram', {
      method: 'POST',
      body: { initData },
      auth: false,
      retryOnNetworkError: true,
    });
  } else if (import.meta.env.VITE_DEV_AUTH === 'true') {
    tokens = await api<IssuedTokens>('/v1/auth/dev', {
      method: 'POST',
      body: { telegramId: devTelegramId(), firstName: 'Dev' },
      auth: false,
      retryOnNetworkError: true,
    });
  } else {
    throw new ApiError('NOT_IN_TELEGRAM', 0);
  }
  useSession
    .getState()
    .setTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

/** Refresh first; if the refresh token is gone too, sign in again with initData. */
async function renewSession(): Promise<boolean> {
  const refreshToken = useSession.getState().tokens?.refreshToken;
  try {
    if (refreshToken) {
      const tokens = await api<IssuedTokens>('/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      });
      useSession
        .getState()
        .setTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    } else {
      await signIn();
    }
    return true;
  } catch {
    try {
      await signIn();
      return true;
    } catch {
      return false;
    }
  }
}

/** Stable mock Telegram id per browser for the dev login (not a secret). */
function devTelegramId(): number {
  const key = 'spincards.devTelegramId';
  try {
    const stored = Number(localStorage.getItem(key));
    if (stored > 0) return stored;
    const id = 1_000_000 + Math.floor(Math.random() * 1_000_000);
    localStorage.setItem(key, String(id));
    return id;
  } catch {
    return 1;
  }
}

/**
 * UUID v4 from crypto.getRandomValues: unlike crypto.randomUUID it also works outside secure
 * contexts (plain-HTTP dev hosts).
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
