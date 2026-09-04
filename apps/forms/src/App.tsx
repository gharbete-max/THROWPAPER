import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { SessionProvider, useSession } from './lib/session.js';
import { DemoBanner, DemoProvider } from './lib/demo.js';
import { BrandProvider, useBrand } from './lib/brand.js';
import { ConfirmProvider } from './components/Confirm.js';
import { Icon, type IconName } from './components/Icon.js';
import { Wordmark } from './components/Logo.js';
import { LanguagePicker } from './components/LanguagePicker.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ToastProvider } from './lib/toast.js';
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
import { foldOnPress } from './lib/fold.js';

/**
 * Code-split: the public form is loaded by anonymous visitors who will never see the app shell,
 * and the shell's bundle should not follow them.
 */
const PublicForm = lazy(() => import('./screens/PublicForm.js'));

/** Code-split: only the door needs a QR decoder, and it is not small. */
const CheckIn = lazy(() => import('./screens/CheckIn.js'));

export function App() {
  /*
   * One listener for every press in the app, attached once.
   *
   * It decorates controls inside `.system` and nothing else, which is what keeps the house
   * animation off a published form — see `lib/fold.ts`.
   */
  useEffect(foldOnPress, []);

  return (
    <BrowserRouter>
      <DemoProvider>
        <SessionProvider>
          <BrandProvider>
            <ConfirmProvider>
              {/* Outside the routes: a toast raised by a screen must survive navigating away
                  from it, which is exactly when "Saved" and "Could not save" are raised. */}
              <ToastProvider>
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
              </ToastProvider>
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
  const { user, organisation, loading, locale, setLocale, interfaceLocales, signOut } =
    useSession();
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
   * How wide the content column gets, which depends on what kind of screen it is.
   *
   * 52rem is a **reading** measure. It is right for a document — a form being filled in, a single
   * event being edited — and wrong for everything else, because a workspace is scanned rather than
   * read. Both kinds were sharing one width, so a list of forms sat in the left two thirds of a
   * laptop with the rest of the page empty, under a top bar that already spanned 76rem.
   *
   * - `wide` (76rem): the builder and the response grid. Three panels, or forty columns.
   * - `roomy` (68rem): the lists — forms, events, responses, users. Enough for two cards abreast
   *   on a large screen without the eye having to travel the full width of the window.
   * - neither: documents, at the reading measure.
   *
   * Matched by path rather than set by the screens themselves, because the element being widened
   * belongs to the shell — a child reaching up to restyle its own container is the kind of thing
   * that works until two of them disagree.
   */
  const path = location.pathname;
  const wide = /^\/forms\/[^/]+/.test(path);
  const roomy =
    !wide && (/^\/(forms|events|responses|users)$/.test(path) || /^\/users\/[^/]+$/.test(path));

  return (
    <div className="app system">
      {/* Inside the shell, so it exists only where there is somewhere to navigate to — the
          sign-in page has one screen and a palette on it would be a joke at the user's expense. */}
      <CommandPalette />
      {/**
       * A sidebar, because the bar could not hold what it was given.
       *
       * Events, Forms, Responses, Users, Brand, a language, a theme, a name and a way out were all
       * asked to sit on one line. At 1440px — an ordinary laptop — that line wrapped, so the
       * product's own sections floated at the right edge on one row while the account controls sat
       * on another, six unlike things sharing an undifferentiated strip. A horizontal bar competes
       * for the one axis a page has least of.
       *
       * Vertical navigation cannot wrap. The sections get a fixed place that does not move as the
       * window changes, the mark sits above them where it reads as the product rather than as
       * decoration, and the top of the page is left for the one thing that belongs there: what you
       * are looking at and what you can do to it.
       *
       * On a narrow screen this becomes a bottom bar — the sections stay reachable by thumb, and
       * `.topline` picks up the mark.
       */}
      <nav className="sidebar" aria-label={t('nav.sections')}>
        <div className="sidebar__mark">
          {brand.logoLight ? (
            <img className="brand-mark" src={brand.logoLight} alt={organisation?.name ?? ''} />
          ) : (
            // The mark stands in for a customer logo until they upload one of their own.
            <Wordmark name={organisation?.name ?? t('app.name')} />
          )}
        </div>

        <div className="sidebar__sections">
          <NavSection to="/events" icon="events" label={t('nav.events')} />
          <NavSection to="/forms" icon="forms" label={t('nav.forms')} />
          <NavSection to="/responses" icon="inbox" label={t('nav.inbox')} />
          {/* Support work, so it only appears for the people who do it. */}
          {user.role === 'admin' && <NavSection to="/users" icon="people" label={t('nav.users')} />}
        </div>

        {/* Brand configures the sections above rather than sitting among them, so it sits apart. */}
        <div className="sidebar__foot">
          <NavSection to="/brand" icon="brand" label={t('nav.brand')} />
        </div>
      </nav>

      {/*
        Everything about *this session* rather than about the work: which language it is read in,
        whether it is light or dark, who is signed in and how to stop being. It is a short row that
        cannot wrap, which is the whole reason the sections are no longer in it.
      */}
      <div className="topline">
        <div className="topline__mark">
          <Wordmark name={organisation?.name ?? t('app.name')} />
        </div>

        {/*
          The palette is invisible until pressed, so it needs somewhere to say it exists. Shown
          only where there is a keyboard to press it with — CSS hides it on coarse pointers and
          narrow screens rather than advertising a shortcut a phone cannot use.
        */}
        <span className="kbd" aria-hidden="true">
          <Icon name="command" />K
        </span>

        {/*
          Driven by the organisation's supportedLocales, not a hard-coded list —
          SPEC-shared.md §packages/i18n. A flag and the language's own name: the list read
          "sv-SE, zh-CN, ru-RU" until recently, which only a developer could use, and at twelve
          entries not even them. The site is in **one** language at a time; a form can offer its
          own switcher separately, which is a different control on a different page.
        */}
        <LanguagePicker
          locales={interfaceLocales.supported}
          current={locale}
          onChange={setLocale}
        />
        {/* Beside the language, because both are "how this app is presented to me". */}
        <ThemeToggle />
        <span className="topline__who small muted">
          {user.name} · {user.role}
        </span>
        <button className="button button--quiet small" onClick={signOut}>
          {t('app.signOut')}
        </button>
      </div>

      <main className="main">
        <div className={`shell${wide ? ' shell--wide' : roomy ? ' shell--roomy' : ''}`}>
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
        </div>
      </main>
    </div>
  );
}
