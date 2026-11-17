import {
  downloadFile as sdkDownloadFile,
  shareMessage as sdkShareMessage,
  shareURL as sdkShareURL,
  backButton,
  openTelegramLink as sdkOpenTelegramLink,
  hapticFeedback,
  init,
  openInvoice as sdkOpenInvoice,
  isTMA,
  miniApp,
  retrieveRawInitData,
  swipeBehavior,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';

/** True inside the Telegram client; in a plain browser every helper below is a no-op. */
export const inTelegram: boolean = (() => {
  try {
    return isTMA();
  } catch {
    return false;
  }
})();

/** Runs a Telegram SDK call; older clients may not support it, which must never break the game. */
function safely(fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Unsupported in this client version.
  }
}

export function initTelegram(): void {
  if (!inTelegram) return;
  safely(() => {
    init();
  });
  safely(() => {
    backButton.mount();
  });
  safely(() => {
    themeParams.mountSync();
  });
  safely(() => {
    themeParams.bindCssVars();
  });
  safely(() => {
    miniApp.mountSync();
  });
  safely(() => {
    miniApp.bindCssVars();
  });
  safely(() => {
    swipeBehavior.mount();
  });
  safely(() => {
    swipeBehavior.disableVertical();
  });
  safely(async () => {
    await viewport.mount();
    viewport.expand();
    viewport.bindCssVars();
  });
  safely(() => {
    miniApp.ready();
  });
}

export function telegramInitData(): string | undefined {
  if (!inTelegram) return undefined;
  try {
    return retrieveRawInitData();
  } catch {
    return undefined;
  }
}

export function telegramLanguage(): string | undefined {
  try {
    const user = new URLSearchParams(telegramInitData() ?? '').get('user');
    return user ? (JSON.parse(user) as { language_code?: string }).language_code : undefined;
  } catch {
    return undefined;
  }
}

export const haptics = {
  impact: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
    if (inTelegram) {
      safely(() => {
        hapticFeedback.impactOccurred(style);
      });
    }
  },
  notify: (type: 'success' | 'warning' | 'error') => {
    if (inTelegram) {
      safely(() => {
        hapticFeedback.notificationOccurred(type);
      });
    }
  },
  select: () => {
    if (inTelegram)
      safely(() => {
        hapticFeedback.selectionChanged();
      });
  },
};

/** Shows Telegram's back button while `handler` is set. */
export function bindBackButton(handler: (() => void) | null): () => void {
  if (!inTelegram) return () => undefined;
  if (!handler) {
    safely(() => {
      backButton.hide();
    });
    return () => undefined;
  }
  safely(() => {
    backButton.show();
  });
  let off: (() => void) | undefined;
  safely(() => {
    off = backButton.onClick(handler);
  });
  return () => off?.();
}

/** Opens a t.me link: inside Telegram natively, otherwise in a new tab. */
export function openTelegramLink(url: string): void {
  if (inTelegram) {
    try {
      sdkOpenTelegramLink(url);
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** Sends a prepared message through Telegram's chat picker (Bot API 8.0); false if unsupported. */
export async function shareMessage(preparedMessageId: string): Promise<boolean> {
  if (!inTelegram || !sdkShareMessage.isAvailable()) return false;
  try {
    await sdkShareMessage(preparedMessageId);
    return true;
  } catch {
    return false;
  }
}

/** Telegram's share sheet with a link and text (older clients, or when preparing failed). */
export function shareURL(url: string, text: string): void {
  if (inTelegram && sdkShareURL.isAvailable()) {
    try {
      sdkShareURL(url, text);
      return;
    } catch {
      // fall through
    }
  }
  window.open(
    `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    '_blank',
    'noopener',
  );
}

/** Asks Telegram to save a file (photos go to the gallery); falls back to opening the URL. */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  if (inTelegram && sdkDownloadFile.isAvailable()) {
    try {
      await sdkDownloadFile(url, fileName);
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** D-146: opens a Stars invoice; 'unsupported' outside Telegram or in old clients. */
export async function openInvoice(
  url: string,
): Promise<'paid' | 'cancelled' | 'failed' | 'pending' | 'unsupported'> {
  if (!inTelegram || !sdkOpenInvoice.isAvailable()) {
    openTelegramLink(url);
    return 'unsupported';
  }
  try {
    const status = await sdkOpenInvoice(url, 'url');
    return status === 'paid' || status === 'cancelled' || status === 'pending' ? status : 'failed';
  } catch {
    return 'failed';
  }
}
