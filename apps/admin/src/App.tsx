import type { AdminMe } from '@spincards/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi, post } from './api';
import { allowed, type Section, SECTIONS } from './sections';
import { Audit } from './screens/Audit';
import { Broadcasts } from './screens/Broadcasts';
import { ConfigDetail, Configs } from './screens/Configs';
import { Dashboard } from './screens/Dashboard';
import { Flags } from './screens/Flags';
import { Admins } from './screens/Admins';
import { Texts } from './screens/Texts';
import { Login } from './screens/Login';
import { Payments } from './screens/Payments';
import { Pool } from './screens/Pool';
import { Seasons } from './screens/Seasons';
import { Settings } from './screens/Settings';
import { UserDetail, Users } from './screens/Users';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** Hash routes: #/users, #/users/<id>, #/pool … */
function useRoute(): [string[], (path: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return [route, (path) => (window.location.hash = `#/${path}`)];
}

export function App() {
  const { t } = useTranslation();
  const [admin, setAdmin] = useState<AdminMe | null | undefined>(undefined);

  useEffect(() => {
    document.title = t('adminTitle', { ns: 'common', appName: t('appName', { ns: 'common' }) });
    adminApi<AdminMe>('/auth/me')
      .then(setAdmin)
      .catch(() => {
        setAdmin(null);
      });
  }, [t]);

  if (admin === undefined) return <main className="login muted">{t('loading')}</main>;
  if (admin === null) return <Login onSignedIn={setAdmin} />;
  return (
    <QueryClientProvider client={queryClient}>
      <Shell
        admin={admin}
        onLogout={() => {
          void post('/auth/logout').finally(() => {
            queryClient.clear();
            setAdmin(null);
          });
        }}
      />
    </QueryClientProvider>
  );
}

function Shell({ admin, onLogout }: { admin: AdminMe; onLogout: () => void }) {
  const { t } = useTranslation();
  const [route, go] = useRoute();
  const visible = SECTIONS.filter((s) => allowed(admin.role, s.id));
  const section = (visible.find((s) => s.id === route[0]) ?? visible[0])?.id;

  const screens: Record<Section, () => ReactElement> = {
    users: () =>
      route[1] ? (
        <UserDetail
          id={route[1]}
          admin={admin}
          onBack={() => {
            go('users');
          }}
        />
      ) : (
        <Users />
      ),
    dashboard: () => <Dashboard />,
    configs: () =>
      route[1] ? (
        <ConfigDetail
          id={Number(route[1])}
          admin={admin}
          onBack={() => {
            go('configs');
          }}
        />
      ) : (
        <Configs
          admin={admin}
          onOpen={(id) => {
            go(`configs/${String(id)}`);
          }}
        />
      ),
    broadcasts: () => <Broadcasts />,
    pool: () => <Pool />,
    payments: () => <Payments admin={admin} />,
    flags: () => <Flags admin={admin} />,
    audit: () => <Audit />,
    seasons: () => <Seasons canEdit={admin.role === 'owner'} />,
    settings: () => <Settings />,
    admins: () => <Admins admin={admin} />,
    texts: () => <Texts />,
  };

  return (
    <div className="shell">
      <nav className="sidebar">
        <strong className="brand">{t('title')}</strong>
        {visible.map((s) => (
          <a key={s.id} href={`#/${s.id}`} className={s.id === section ? 'active' : ''}>
            {t(`nav.${s.id}`)}
          </a>
        ))}
        <div className="whoami">
          <span>{admin.login}</span>
          <span className="muted">{t(`roles.${admin.role}`)}</span>
          <button type="button" onClick={onLogout}>
            {t('login.logout')}
          </button>
        </div>
      </nav>
      <main className="content">
        {section && <p className="intro muted">{t(`intro.${section}`)}</p>}
        {section ? screens[section]() : null}
      </main>
    </div>
  );
}
