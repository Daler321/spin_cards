import type { AdminLoginResponse, AdminMe } from '@spincards/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../api';
import { useErrorText } from '../format';

type Step =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'setup'; setupToken: string; secret: string; otpauthUrl: string };

/** Login + password, then the TOTP code; on the first login the TOTP secret is set up. */
export function Login({ onSignedIn }: { onSignedIn: (admin: AdminMe) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = (response: AdminLoginResponse) => {
    if (response.stage === 'done') onSignedIn(response.admin);
    else if (response.stage === 'totp_required') setStep({ kind: 'code' });
    else setStep({ kind: 'setup', ...response });
    setCode('');
  };

  const submit = () => {
    setBusy(true);
    setError(null);
    const request =
      step.kind === 'setup'
        ? post<AdminLoginResponse>('/auth/totp/setup', { setupToken: step.setupToken, code })
        : post<AdminLoginResponse>('/auth/login', {
            login,
            password,
            ...(step.kind === 'code' && { totp: code }),
          });
    request
      .then(handle)
      .catch((e: unknown) => {
        setError(errorText(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <main className="login">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h1>{step.kind === 'setup' ? t('login.setupTitle') : t('login.title')}</h1>
        {step.kind === 'password' && (
          <>
            <label>
              {t('login.login')}
              <input
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value);
                }}
                autoComplete="username"
                required
              />
            </label>
            <label>
              {t('login.password')}
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                autoComplete="current-password"
                required
              />
            </label>
          </>
        )}
        {step.kind === 'setup' && (
          <>
            <p className="muted">{t('login.setupText')}</p>
            <label>
              {t('login.secret')}
              <code className="secret">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </label>
            <a href={step.otpauthUrl}>{t('login.openApp')}</a>
          </>
        )}
        {step.kind !== 'password' && (
          <label>
            {t('login.code')}
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
              required
            />
            <span className="muted">{t('login.codeHint')}</span>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button
          type="submit"
          className="primary"
          disabled={busy || (step.kind !== 'password' && code.length !== 6)}
        >
          {t('login.submit')}
        </button>
      </form>
    </main>
  );
}
