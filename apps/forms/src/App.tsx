import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { SessionProvider, useSession } from './lib/session.js';
import { DemoBanner, DemoProvider } from './lib/demo.js';
import { BrandProvider, useBrand } from './lib/brand.js';
import { ConfirmProvider } from './components/Confirm.js';
import { Icon } from './components/Icon.js';
import { useT } from './lib/i18n.js';
import { Login } from './screens/Login.js';
import { Callback } from './screens/Callback.js';
import { Events } from './screens/Events.js';
import { EventForm } from './screens/EventForm.js';
import { Forms } from './screens/Forms.js';
import { BrandKit } from './screens/BrandKit.js';
import { FormBuilder } from './screens/builder/FormBuilder.js';
import { EventReport } from './screens/EventReport.js';

/**
 * Code-split: the public form is loaded by anonymous visitors who will never see the app shell,
 * and the shell's bundle should not follow them.
 */
const PublicForm = lazy(() => import('./screens/PublicForm.js'));

/** Code-split: only the door needs a QR decoder, and it is not small. */
const CheckIn = lazy(() => import('./screens/CheckIn.js'));

export function App() {
  return (
    <BrowserRouter>
      <DemoProvider>
        <SessionProvider>
          <BrandProvider>
            <ConfirmProvider>
              <DemoBanner />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/auth/callback" element={<Callback />} />
                <Route
                  path="/f/:slug"
                  element={
                    <Suspense fallback={<main className="shell shell--narrow" />}>
                      <PublicForm />
                    </Suspense>
                  }
                />
                <Route path="/*" element={<Shell />} />
              </Routes>
            </ConfirmProvider>
          </BrandProvider>
        </SessionProvider>
      </DemoProvider>
    </BrowserRouter>
  );
}

/** Everything behind the bearer token. */
function Shell() {
  const t = useT();
  const { user, organisation, loading, locale, setLocale, locales, signOut } = useSession();
  const { tokens: brand } = useBrand();

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">{t('app.loading')}</p>
      </main>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          {brand.logoLight ? (
            <img className="brand-mark" src={brand.logoLight} alt={organisation?.name ?? ''} />
          ) : (
            <strong>{organisation?.name ?? t('app.name')}</strong>
          )}
          <nav className="row">
            <Link className="button button--quiet small" to="/events">
              <Icon name="events" />
              {t('nav.events')}
            </Link>
            <Link className="button button--quiet small" to="/forms">
              <Icon name="forms" />
              {t('nav.forms')}
            </Link>
            <Link className="button button--quiet small" to="/brand">
              <Icon name="brand" />
              {t('nav.brand')}
            </Link>
            {/*
              The language dropdown is driven by the organisation's supportedLocales, not a
              hard-coded list — SPEC-shared.md §packages/i18n.
            */}
            <label className="field field--inline">
              <span className="small muted">{t('app.language')}</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {locales.supported.map((supported) => (
                  <option key={supported} value={supported}>
                    {supported}
                  </option>
                ))}
              </select>
            </label>
            <span className="small muted">
              {user.name} · {user.role}
            </span>
            <button className="button button--quiet" onClick={signOut}>
              {t('app.signOut')}
            </button>
          </nav>
        </div>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/" element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/new" element={<EventForm />} />
          <Route path="/events/:id" element={<EventForm />} />
          <Route path="/forms" element={<Forms />} />
          <Route path="/brand" element={<BrandKit />} />
          <Route path="/forms/:id" element={<FormBuilder />} />
          <Route path="/events/:id/attendance" element={<EventReport />} />
          <Route
            path="/events/:id/check-in"
            element={
              <Suspense fallback={<p className="muted">…</p>}>
                <CheckIn />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </main>
    </div>
  );
}
