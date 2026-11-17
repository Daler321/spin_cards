import { useTranslation } from 'react-i18next';
import {
  CONFIG_SECTIONS,
  type ConfigField,
  fromDisplay,
  readPath,
  toDisplay,
  writePath,
} from '../config-fields';

const TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;

/** Grouped, labelled form over the most tuned config parameters (the rest is in JSON). */
export function ConfigForm({
  value,
  editable,
  onChange,
}: {
  value: object;
  editable: boolean;
  onChange: (next: object) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="config-form">
      {CONFIG_SECTIONS.filter((section) =>
        // Optional sections (mini-games) are missing in older versions: nothing to edit there.
        section.fields.every((field) => readPath(value, field.path.slice(0, 1)) !== undefined),
      ).map((section) => (
        <fieldset key={section.id} className="card">
          <legend>{t(`cfg.sections.${section.id}`)}</legend>
          {section.fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              label={t(`cfg.${section.id}.${field.key}.label`)}
              hint={t(`cfg.${section.id}.${field.key}.hint`)}
              value={readPath(value, field.path)}
              editable={editable}
              onChange={(next) => {
                onChange(writePath(value, field.path, next));
              }}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Field({
  field,
  label,
  hint,
  value,
  editable,
  onChange,
}: {
  field: ConfigField;
  label: string;
  hint: string;
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const unit =
    field.kind === 'money'
      ? field.currency === 'USD'
        ? '$'
        : '₽'
      : field.kind === 'percent' || field.kind === 'multiplier'
        ? t(`cfg.units.${field.kind}`)
        : null;
  return (
    <div className="cfg-field">
      <div className="cfg-label">
        <strong>{label}</strong>
        <span className="muted">{hint}</span>
      </div>
      <div className="cfg-input">
        {field.kind === 'bool' ? (
          <input
            type="checkbox"
            checked={value === true}
            disabled={!editable}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
        ) : field.kind === 'tier' ? (
          <select
            value={typeof value === 'string' ? value : ''}
            disabled={!editable}
            onChange={(e) => {
              onChange(e.target.value === '' ? null : e.target.value);
            }}
          >
            <option value="">—</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        ) : (
          <NumberInput kind={field.kind} value={value} editable={editable} onChange={onChange} />
        )}
        {unit && <span className="muted">{unit}</span>}
      </div>
    </div>
  );
}

function NumberInput({
  kind,
  value,
  editable,
  onChange,
}: {
  kind: ConfigField['kind'];
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const shown = toDisplay(kind, value);
  return (
    <input
      className="num"
      defaultValue={shown}
      key={shown}
      disabled={!editable}
      inputMode="decimal"
      title={t('cfg.invalid')}
      onBlur={(e) => {
        const next = fromDisplay(kind, e.target.value);
        if (next === null) e.target.value = shown;
        else if (next !== value) onChange(next);
      }}
    />
  );
}
