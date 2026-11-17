import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { haptics } from '../app/telegram';
import { type Tab, useNavigation } from '../state/navigation';

const ICONS: Record<(typeof TABS)[number], ReactElement> = {
  game: <path d="M4 7h13v10H4zM7 4h13v10" />,
  holder: <path d="M4 6h16v13H4zM4 10h16M9 14h6" />,
  bonuses: <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0" />,
  rating: <path d="M5 20V11M12 20V5M19 20v-6" />,
  more: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
};

const TABS = ['game', 'holder', 'bonuses', 'rating', 'more'] as const;
/** Screens without a button of their own light up the tab they open from. */
const HOME: Partial<Record<Tab, Tab>> = { wallet: 'more' };

export function TabBar({ badges }: { badges: Partial<Record<Tab, boolean>> }) {
  const { t } = useTranslation('common');
  const current = useNavigation((s) => s.tab);
  const tab = HOME[current] ?? current;
  const setTab = useNavigation((s) => s.setTab);
  return (
    <nav className="tabbar">
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          className={`tabbar-item ${tab === id ? 'is-active' : ''}`}
          aria-current={tab === id ? 'page' : undefined}
          aria-label={t(`nav.${id}`)}
          onClick={() => {
            haptics.select();
            setTab(id);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            {ICONS[id]}
          </svg>
          {badges[id] && <span className="tabbar-badge" />}
        </button>
      ))}
    </nav>
  );
}
