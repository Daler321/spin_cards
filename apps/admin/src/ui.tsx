import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from './format';

export function Table({
  head,
  rows,
  empty,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  empty?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="muted">
                {empty ?? t('empty')}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A button that opens a small form asking for the mandatory reason (plus optional fields) before
 * the action runs.
 */
export function ReasonAction({
  label,
  danger = false,
  disabled = false,
  children,
  onSubmit,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button
        type="button"
        className={danger ? 'danger' : ''}
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </button>
    );
  return (
    <form
      className="reason-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        onSubmit(reason.trim())
          .then(() => {
            setOpen(false);
            setReason('');
          })
          .catch((err: unknown) => {
            setError(errorText(err));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <strong>{label}</strong>
      {children}
      <label>
        {t('reason')}
        <input
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          minLength={3}
          required
        />
      </label>
      <span className="muted">{t('reasonHint')}</span>
      {error && <span className="error">{error}</span>}
      <div className="row">
        <button
          type="submit"
          className={danger ? 'danger' : 'primary'}
          disabled={busy || reason.trim().length < 3}
        >
          {t('confirm')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
