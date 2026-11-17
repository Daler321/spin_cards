import type {
  BotChannelPostRequest,
  BotChannelPostResponse,
  BotChatStatusRequest,
  BotSettingsRequest,
  BotStartRequest,
  BotStartResponse,
  ClaimNotificationsResponse,
  NotificationKind,
  NotificationResultRequest,
  PreCheckoutRequest,
  PreCheckoutResponse,
  SubscriptionStatus,
  SuccessfulPaymentRequest,
  SuccessfulPaymentResponse,
  TextSettings,
} from '@spincards/shared';

const TIMEOUT_MS = 10_000;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`internal api ${String(status)}${code ? ` ${code}` : ''}`);
  }
}

/** The bot's only way to the data (CLAUDE.md: no direct DB access): internal api routes. */
export class InternalApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  start(body: BotStartRequest) {
    return this.post<BotStartResponse>('/internal/bot/start', body);
  }

  settings(body: BotSettingsRequest) {
    return this.post<undefined>('/internal/bot/settings', body);
  }

  chatStatus(body: BotChatStatusRequest) {
    return this.post<undefined>('/internal/bot/chat-status', body);
  }

  texts() {
    return this.post<TextSettings>('/internal/bot/texts', {});
  }

  subscription(telegramId: string, fresh = false) {
    return this.post<SubscriptionStatus>('/internal/bot/subscription', { telegramId, fresh });
  }

  claim(limit: number, kinds?: readonly NotificationKind[]) {
    return this.post<ClaimNotificationsResponse>('/internal/bot/notifications/claim', {
      limit,
      ...(kinds && kinds.length > 0 && { kinds }),
    });
  }

  report(id: string, body: NotificationResultRequest) {
    return this.post<undefined>(`/internal/bot/notifications/${id}/result`, body);
  }

  channelPost(body: BotChannelPostRequest) {
    return this.post<BotChannelPostResponse>('/internal/bot/channel-post', body);
  }

  preCheckout(body: PreCheckoutRequest) {
    return this.post<PreCheckoutResponse>('/internal/bot/payments/pre-checkout', body);
  }

  paymentSucceeded(body: SuccessfulPaymentRequest) {
    return this.post<SuccessfulPaymentResponse>('/internal/bot/payments/success', body);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': this.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 204) return undefined as T;
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (json as { error?: { code?: string } } | null)?.error?.code;
      throw new ApiRequestError(response.status, code);
    }
    return json as T;
  }
}
