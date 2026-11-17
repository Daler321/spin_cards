import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/** getChatMember errors that mean the user is simply not in the chat. */
const NOT_A_MEMBER = /PARTICIPANT_ID_INVALID|user not found|member not found/i;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface InvoiceLinkParams {
  title: string;
  description: string;
  payload: string;
  /** Telegram Stars: currency XTR, one price item, no provider token. */
  starsAmount: number;
}

/** Bot API calls the api makes itself (invoice links). The token never appears in logs or errors. */
@Injectable()
export class TelegramApiService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  createInvoiceLink(params: InvoiceLinkParams): Promise<string> {
    return this.call<string>('createInvoiceLink', {
      title: params.title,
      description: params.description,
      payload: params.payload,
      currency: 'XTR',
      prices: [{ label: params.title, amount: params.starsAmount }],
    });
  }

  /** Returns the Stars of a successful payment to the player (TZ 9). */
  refundStarPayment(telegramUserId: string, chargeId: string): Promise<boolean> {
    return this.call<boolean>('refundStarPayment', {
      user_id: Number(telegramUserId),
      telegram_payment_charge_id: chargeId,
    });
  }

  /** Membership status of a user in a chat; the bot must be an admin of the channel. */
  async getChatMemberStatus(chatId: string, userId: number): Promise<string> {
    let member: { status: string; is_member?: boolean };
    try {
      member = await this.call('getChatMember', { chat_id: chatId, user_id: userId });
    } catch (error) {
      // D-153: Telegram answers so for someone who is not in the channel (often a player who
      // came straight into the Mini App and never opened the chat): not a member, not an outage.
      if (error instanceof Error && NOT_A_MEMBER.test(error.message)) return 'left';
      throw error;
    }
    return member.status === 'restricted' && member.is_member ? 'member' : member.status;
  }

  /** A message the user can send from the Mini App via shareMessage (Bot API 8.0). */
  async savePreparedPhoto(
    userId: number,
    photo: { id: string; url: string; caption: string },
  ): Promise<string> {
    const result = await this.call<{ id: string }>('savePreparedInlineMessage', {
      user_id: userId,
      result: {
        type: 'photo',
        id: photo.id,
        photo_url: photo.url,
        thumbnail_url: photo.url,
        caption: photo.caption,
        parse_mode: 'HTML',
      },
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
    return result.id;
  }

  /** A plain HTML message to a chat (ops alerts to the owner). */
  async sendMessage(chatId: string, html: string): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  /** D-173: the current first and last name of a user who has a chat with the bot. */
  async getChatName(userId: number): Promise<{ firstName: string; lastName: string | null }> {
    const chat = await this.call<{ first_name?: string; last_name?: string }>('getChat', {
      chat_id: userId,
    });
    return { firstName: chat.first_name ?? '', lastName: chat.last_name ?? null };
  }

  async getMe(): Promise<{ id: number; username?: string }> {
    return this.call('getMe', {});
  }

  private username: { value: string; at: number } | null = null;

  /** The bot's @username, cached; a failed lookup is retried after a minute. */
  async botUsername(): Promise<string> {
    const cached = this.username;
    if (cached && (cached.value || Date.now() - cached.at < 60_000)) return cached.value;
    const value = await this.getMe()
      .then((me) => me.username ?? '')
      .catch(() => '');
    this.username = { value, at: Date.now() };
    return value;
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    if (!this.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const response = await fetch(
      `${this.env.TELEGRAM_API_URL}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await response.json().catch(() => null)) as TelegramResponse<T> | null;
    if (!json?.ok || json.result === undefined) {
      throw new Error(`Telegram ${method} failed: ${json?.description ?? String(response.status)}`);
    }
    return json.result;
  }
}
