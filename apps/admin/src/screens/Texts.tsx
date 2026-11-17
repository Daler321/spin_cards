import type { AdminTextsResponse } from '@spincards/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from '../api';
import { ReasonAction } from '../ui';

type Item = AdminTextsResponse['items'][number];

/** Owner-edited texts of the Mini App and the bot, and the extra /start button (D-134). */
export function Texts() {
  const { t } = useTranslation();
  const texts = useQuery({
    queryKey: ['texts'],
    queryFn: () => adminApi<AdminTextsResponse>('/settings/texts'),
  });
  const data = texts.data;
  return (
    <section>
      <h2>{t('nav.texts')}</h2>
      <p className="muted">{t('texts.hint')}</p>
      {data && (
        <>
          <h3>{t('texts.miniApp')}</h3>
          {data.items
            .filter((i) => i.group === 'miniApp')
            .map((item) => (
              <TextRow key={item.key} item={item} />
            ))}
          <h3>{t('texts.bot')}</h3>
          {data.items
            .filter((i) => i.group === 'bot')
            .map((item) => (
              <TextRow key={item.key} item={item} />
            ))}
          <StartLink current={data.startLink} />
          <BotOptionsForm current={data.bot} />
        </>
      )}
    </section>
  );
}

function TextRow({ item }: { item: Item }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [value, setValue] = useState(item.override ?? item.defaultText);
  const refresh = () => client.invalidateQueries({ queryKey: ['texts'] });
  return (
    <div className="card">
      <div className="row spread">
        <strong>
          {t(`texts.keys.${item.key.replace(/[:.]/g, '_')}`, { defaultValue: item.key })}
        </strong>
        <span className={`tag ${item.override ? 'ok' : ''}`}>
          {item.override ? t('texts.edited') : t('texts.default')}
        </span>
      </div>
      <textarea
        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 70)))}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
      {item.override && (
        <p className="muted">{t('texts.defaultWas', { text: item.defaultText })}</p>
      )}
      <div className="actions">
        <ReasonAction
          label={t('save')}
          disabled={value === (item.override ?? item.defaultText)}
          onSubmit={(reason) =>
            post('/settings/texts', { key: item.key, value, reason }).then(refresh)
          }
        />
        {item.override && (
          <ReasonAction
            label={t('texts.reset')}
            onSubmit={(reason) =>
              post('/settings/texts', { key: item.key, value: null, reason }).then(() => {
                setValue(item.defaultText);
                return refresh();
              })
            }
          />
        )}
      </div>
    </div>
  );
}

function StartLink({ current }: { current: AdminTextsResponse['startLink'] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [text, setText] = useState(current?.text ?? '');
  const [url, setUrl] = useState(current?.url ?? '');
  const refresh = () => client.invalidateQueries({ queryKey: ['texts'] });
  return (
    <div className="card">
      <strong>{t('texts.startLink')}</strong>
      <p className="muted">{t('texts.startLinkHint')}</p>
      <div className="row">
        <label>
          {t('texts.buttonText')}
          <input
            value={text}
            maxLength={64}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </label>
        <label>
          {t('texts.buttonUrl')}
          <input
            value={url}
            placeholder="https://t.me/channel"
            onChange={(e) => {
              setUrl(e.target.value.trim());
            }}
          />
        </label>
      </div>
      <div className="actions">
        <ReasonAction
          label={t('save')}
          disabled={!text.trim() || !url.startsWith('https://')}
          onSubmit={(reason) =>
            post('/settings/texts/start-link', { startLink: { text, url }, reason }).then(refresh)
          }
        />
        {current && (
          <ReasonAction
            label={t('texts.removeButton')}
            onSubmit={(reason) =>
              post('/settings/texts/start-link', { startLink: null, reason }).then(() => {
                setText('');
                setUrl('');
                return refresh();
              })
            }
          />
        )}
      </div>
    </div>
  );
}

/** D-145: where support messages go and whether channel posts reach players. */
function BotOptionsForm({ current }: { current: AdminTextsResponse['bot'] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [chatId, setChatId] = useState(current.supportChatId ?? '');
  const [channelPosts, setChannelPosts] = useState(current.channelPosts);
  const valid = chatId === '' || /^-?\d{1,20}$/.test(chatId);
  const changed = chatId !== (current.supportChatId ?? '') || channelPosts !== current.channelPosts;
  return (
    <div className="card">
      <strong>{t('texts.botOptions')}</strong>
      <p className="muted">{t('texts.supportHint')}</p>
      <label>
        {t('texts.supportChat')}
        <input
          value={chatId}
          placeholder="-1001234567890"
          onChange={(e) => {
            setChatId(e.target.value.trim());
          }}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={channelPosts}
          onChange={(e) => {
            setChannelPosts(e.target.checked);
          }}
        />
        {t('texts.channelPosts')}
      </label>
      <p className="muted">{t('texts.channelPostsHint')}</p>
      <div className="actions">
        <ReasonAction
          label={t('save')}
          disabled={!valid || !changed}
          onSubmit={(reason) =>
            post('/settings/texts/bot', {
              bot: { supportChatId: chatId === '' ? null : chatId, channelPosts },
              reason,
            }).then(() => client.invalidateQueries({ queryKey: ['texts'] }))
          }
        />
      </div>
    </div>
  );
}
