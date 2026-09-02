import { Suspense, lazy } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { SessionProvider, useSession } from './lib/session.js';
import { DemoBanner, DemoProvider } from './lib/demo.js';
import { BrandProvider, useBrand } from './lib/brand.js';
import { ConfirmProvider } from './components/Confirm.js';
import { Icon, type IconName } from './components/Icon.js';
import { Wordmark } from './components/Logo.js';
import { Intro } from './components/Intro.js';
import { useT } from './lib/i18n.js';
import { Login } from './screens/Login.js';
import { Callback } from './screens/Callback.js';

/**
 * The signed-in application, split out of the entry chunk.
 *
 * The reason is who pays for it. A member of the public opening `/f/spring-meeting` has no use
 * for the form builder, the drag-and-drop library it needs or the data grid — and before this they
 * downloaded every byte of all of it, because `App` imported those screens at the top level and
 * so they landed in the entry chunk that loads before anything renders.
 *
 * A respondent is by far the most common visitor this product has, usually on a phone, often on a
 * bad connection, and they never see any of these screens. Sign-in is deliberately *not* lazy:
 * it is the first thing a returning operator needs, and a spinner in front of a password box to
 * save a few kilobytes is a poor trade.
 */
const Events = lazy(() => import('./screens/Events.js').then((m) => ({ default: m.Events })));
const EventForm = lazy(() =>
  import('./screens/EventForm.js').then((m) => ({ default: m.EventForm })),
);
const Forms = lazy(() => import('./screens/Forms.js').then((m) => ({ default: m.Forms })));
const BrandKit = lazy(() => import('./screens/BrandKit.js').then((m) => ({ default: m.BrandKit })));
const FormBuilder = lazy(() =>
  import('./screens/builder/FormBuilder.js').then((m) => ({ default: m.FormBuilder })),
);
const EventReport = lazy(() =>
  import('./screens/EventReport.js').then((m) => ({ default: m.EventReport })),
);
const FormResponses = lazy(() =>
  import('./screens/FormResponses.js').then((m) => ({ default: m.FormResponses })),
);
const Inbox = lazy(() => import('./screens/Inbox.js').then((m) => ({ default: m.Inbox })));
const Users = lazy(() => import('./screens/Users.js').then((m) => ({ default: m.Users })));
const UserWorkspace = lazy(() =>
  import('./screens/UserWorkspace.js').then((m) => ({ default: m.UserWorkspace })),
);
import { Loading } from './components/Loading.js';

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
              <Intro />
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

/**
 * One top-level destination, which knows whether you are already there.
 *
 * `NavLink` rather than `Link` so the current section is marked — three identical quiet buttons
 * told you nothing about where you were, which is most of what a top bar is for. `aria-current`
 * comes from `NavLink` itself, so the styling and the announcement cannot disagree.
 *
 * `end` is deliberately **not** set: `/forms/:id` and `/forms/:id/submissions` are still Forms,
 * and a section that unhighlights the moment you open something inside it is worse than none.
 */
function NavSection({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink
      className={({ isActive }) =>
        isActive
          ? 'button button--quiet small nav-link nav-link--current'
          : 'button button--quiet small nav-link'
      }
      to={to}
    >
      <Icon name={icon} className="icon--lead" />
      {label}
    </NavLink>
  );
}

/** Everything behind the bearer token. */
function Shell() {
  const t = useT();
  const { user, organisation, loading, locale, setLocale, locales, signOut } = useSession();
  const { tokens: brand } = useBrand();
  const location = useLocation();

  if (loading) {
    return (
      <main className="shell">
        <Loading />
      </main>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  /**
   * The two screens that are workspaces rather than documents.
   *
   * 52rem is a reading measure — right for a list of forms, and wrong for a builder with a
   * palette, a canvas and a live preview side by side, or for a grid of forty responses. Both were
   * squeezed into the left two thirds of an ordinary laptop with the rest of the page empty, while
   * the top bar above them already spanned 76rem.
   *
   * Matched by path rather than set by the screens themselves, because the element being widened
   * belongs to the shell — a child reaching up to restyle its own container is the kind of thing
   * that works until two of them disagree.
   */
  const wide = /^\/forms\/[^/]+/.test(location.pathname);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          {brand.logoLight ? (
            <img className="brand-mark" src={brand.logoLight} alt={organisation?.name ?? ''} />
          ) : (
            // The mark stands in for a customer logo until they upload one of their own.
            <Wordmark name={organisation?.name ?? t('app.name')} />
          )}
          {/**
           * Two groups, not one row of six things.
           *
           * Events, Forms and Brand used to sit in the same flat row as the language dropdown,
           * the signed-in name and Sign out, all styled identically — so "where am I" and "who am
           * I" were the same question, and on a narrow screen the whole lot wrapped into a
           * jumble. The left group is the product; the right group is the account.
           */}
          <nav className="topbar__nav" aria-label={t('nav.sections')}>
            <NavSection to="/events" icon="events" label={t('nav.events')} />
            <NavSection to="/forms" icon="forms" label={t('nav.forms')} />
            <NavSection to="/responses" icon="inbox" label={t('nav.inbox')} />
            {/* Support work, so it only appears for the people who do it. */}
            {user.role === 'admin' && (
              <NavSection to="/users" icon="people" label={t('nav.users')} />
            )}
          </nav>

          <div className="topbar__account">
            {/* Brand is settings — it configures the other two rather than sitting beside them. */}
            <NavSection to="/brand" icon="brand" label={t('nav.brand')} />
            {/*
              The language dropdown is driven by the organisation's supportedLocales, not a
              hard-coded list — SPEC-shared.md §packages/i18n.
            */}
            {/* The globe carries the label, so the word does not also take a slot in the bar.
                The name moves onto the select itself rather than disappearing. */}
            <span className="field field--inline">
              <Icon name="globe" className="muted" />
              <select
                aria-label={t('app.language')}
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
              >
                {locales.supported.map((supported) => (
                  <option key={supported} value={supported}>
                    {supported}
                  </option>
                ))}
              </select>
            </span>
            <span className="small muted">
              {user.name} · {user.role}
            </span>
            <button className="button button--quiet small" onClick={signOut}>
              {t('app.signOut')}
            </button>
          </div>
        </div>
      </header>

      <main className={wide ? 'shell shell--wide' : 'shell'}>
        {/* One boundary for the whole table: these screens are alternatives, never siblings, so
            seven separate ones would only mean seven copies of the same fallback. */}
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Navigate to="/events" replace />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/new" element={<EventForm />} />
            <Route path="/events/:id" element={<EventForm />} />
            <Route path="/forms" element={<Forms />} />
            <Route path="/responses" element={<Inbox />} />
            <Route path="/users" element={<Users />} />
            <Route path="/users/:id" element={<UserWorkspace />} />
            <Route path="/brand" element={<BrandKit />} />
            {/* Before `/forms/:id`, or the builder would claim `submissions` as an id. */}
            <Route path="/forms/:id/submissions" element={<FormResponses />} />
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
        </Suspense>
      </main>
    </div>
  );
}
