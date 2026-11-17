/**
 * Texts the owner may edit in the admin panel (D-134), as `namespace:key` of the i18n resources.
 * Overrides live in the database and replace the i18n defaults at runtime (Mini App: with the
 * public config; bot: polled from the internal api). Only plain `{name}` placeholders that the
 * default already has are allowed in an override, so a typo cannot break the ICU formatting.
 */
export const EDITABLE_TEXTS = {
  miniApp: [
    'game:subscribe.title',
    'game:subscribe.text',
    'game:subscribe.join',
    'game:subscribe.check',
    'game:subscribe.notYet',
    'common:rules.body',
    'common:privacy.body',
    'game:odds.intro',
    'game:odds.luckBody',
    'game:odds.patternsBody',
    'game:odds.nearMissBody',
    'game:odds.rewardsScale',
    'game:album.hint',
  ],
  bot: [
    'bot:start.greeting',
    'bot:start.welcomeBack',
    'bot:start.playButton',
    'bot:start.noWebApp',
    'bot:help',
    'bot:rulesTitle',
    'bot:disclaimer',
    'bot:subscribe.text',
    'bot:subscribe.join',
    'bot:subscribe.check',
    'bot:subscribe.notYet',
    'bot:subscribe.thanks',
    'bot:notify.free_spin_ready',
    'bot:notify.comeback',
    'bot:notify.openButton',
    'bot:payments.thanks',
    'bot:start.refButton',
    'bot:start.supportButton',
    'bot:ref.text',
    'bot:ref.shareText',
    'bot:support.prompt',
    'bot:support.sent',
    'bot:support.off',
    'bot:support.reply',
    'bot:support.closed',
    'bot:support.hint',
  ],
} as const;

/** Mini App texts the bot shows too (/rules): an override reaches both. */
export const BOT_SHARED_TEXTS: readonly EditableTextKey[] = ['common:rules.body'];

export type EditableTextKey =
  (typeof EDITABLE_TEXTS)['miniApp'][number] | (typeof EDITABLE_TEXTS)['bot'][number];

export const EDITABLE_TEXT_KEYS: readonly EditableTextKey[] = [
  ...EDITABLE_TEXTS.miniApp,
  ...EDITABLE_TEXTS.bot,
];

/** An extra link button under the bot's /start reply (e.g. the news channel). */
export interface StartLinkButton {
  text: string;
  url: string;
}

/** D-145: where the bot sends support messages, and whether channel posts reach players. */
export interface BotOptions {
  /** Telegram id of the support group (the bot must be in it); null: support is off. */
  supportChatId: string | null;
  /** Forward new posts of the required channels to players with notifications on. */
  channelPosts: boolean;
}

export interface TextSettings {
  overrides: Partial<Record<EditableTextKey, string>>;
  startLink: StartLinkButton | null;
  bot: BotOptions;
}

/** Top-level `{...}` groups of an ICU message: `{name}` and `{count, plural, ...}` alike. */
function braceGroups(text: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}' && depth > 0) {
      depth--;
      if (depth === 0) groups.push(text.slice(start + 1, i));
    }
  }
  return groups;
}

/** Variable names a default text uses (`{name}`, and the variable of `{count, plural, ...}`). */
export function textVariables(text: string): string[] {
  return [...new Set(braceGroups(text).map((g) => g.split(',')[0]?.trim() ?? ''))].filter(Boolean);
}

/**
 * Null if the override is safe; otherwise why not: only plain `{name}` placeholders of variables
 * the default has, and balanced braces.
 */
export function overrideProblem(defaultText: string, override: string): string | null {
  const opens = (override.match(/\{/g) ?? []).length;
  const closes = (override.match(/\}/g) ?? []).length;
  if (opens !== closes) return 'unbalanced braces';
  const allowed = new Set(textVariables(defaultText));
  for (const group of braceGroups(override)) {
    if (!/^\w+$/.test(group.trim())) return `only plain placeholders like {name} are allowed`;
    if (!allowed.has(group.trim())) return `unknown placeholder {${group.trim()}}`;
  }
  return null;
}
