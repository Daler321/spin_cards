import type { MeResponse, PublicConfigResponse } from '@spincards/shared';
import { useTranslation } from 'react-i18next';

/** Level, the EXP bar and how much is left to the next level: information only, not a button. */
export function LevelInfo({
  me,
  config,
  className = 'header-level',
}: {
  me: MeResponse;
  config: PublicConfigResponse;
  className?: string;
}) {
  const { t } = useTranslation('game');
  const levelFloor = config.levels.find((l) => l.level === me.level)?.exp ?? 0;
  const progress =
    me.nextLevelExp === null
      ? 1
      : (me.exp - levelFloor) / Math.max(1, me.nextLevelExp - levelFloor);
  return (
    <span className={className}>
      <span className="header-level-label">{t('header.level', { level: me.level })}</span>
      <span
        className="exp-bar"
        aria-label={
          me.nextLevelExp === null
            ? t('header.maxLevel')
            : t('header.exp', { exp: me.exp, next: me.nextLevelExp })
        }
      >
        <span
          className="exp-bar-fill"
          style={{ width: `${String(Math.min(100, progress * 100))}%` }}
        />
      </span>
      <span className="header-exp-left">
        {me.nextLevelExp === null
          ? t('header.maxLevel')
          : t('header.expLeft', { exp: me.nextLevelExp - me.exp, level: me.level + 1 })}
      </span>
    </span>
  );
}
