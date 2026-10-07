import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type Ref,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { roomCssVariables, toCssVariables, toDark } from '@tp/tokens';
import { useSession } from '../lib/session.js';
import { useBrand } from '../lib/brand.js';
import { useT } from '../lib/i18n.js';
import { useEdition } from '../lib/edition.js';
import { rememberIntroSeen, useReducedMotion } from '../lib/motion.js';
import { Mark } from '../components/Mark.js';
import { Icon, type IconName } from '../components/Icon.js';
import { LanguagePicker } from '../components/LanguagePicker.js';
import { Wordmark } from '../components/Logo.js';
import { FACETS, MARK, type Facet } from '../components/mark-geometry.js';

/** The opened Documents catcher has an address, so Back closes it and a link can open it. */
const ROOM_PATH = '/room';
const DOCUMENTS_PATH = '/room/documents';

/** Where the last press zoomed from, read once by the state it opens. */
let zoomFrom: DOMRect | null = null;

/**
 * The zoom: the element that arrives grows out of the one that was pressed, or shrinks back into
 * it, on the brand's `unfurl` curve. Transform only.
 *
 * Not a view transition. That was the first build, and spike S2 measured it: the browser's
 * snapshot of the page held frames for 66 ms at full speed and 100 ms at a quarter, where this
 * keeps every frame under 17 ms at a quarter (`docs/plan/DOCUMENTS.md` §6, phase 2).
 */
function zoom(target: Element, from: DOMRect) {
  const to = target.getBoundingClientRect();
  if (to.width === 0) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const easing = getComputedStyle(target).getPropertyValue('--tp-ease-unfurl').trim() || 'ease-out';
  target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` },
      { transform: 'none' },
    ],
    { duration: 380, easing },
  );
}

/**
 * The room: where a signed-in person arrives (ADR 0022, `docs/VISION.md` §2).
 *
 * An empty dark grey room with three cootie catchers floating in it, each over one of Loppa's own
 * colours made stronger. They are three independent tools that never link to each other.
 * Documents is built. Pressing it zooms in on it and opens it into its four parts around a centre.
 * Spreadsheets and Presentation & planning are placeholders: they float, are named, and say they
 * are not built yet. They are not links, not buttons and not focusable, because a control that
 * does nothing is a lie (`room.spec.ts` holds that).
 *
 * ## Why the room sets its own variables
 *
 * The room is always dark grey, whatever theme the tools are in. Its controls (the language
 * picker, Sign out) are the app's own components, so the room hands them the brand's derived dark
 * palette and adds its fixed colours from `@tp/tokens`. Nothing outside the room sees either.
 */
export function Room() {
  const t = useT();
  const { user, organisation, locale, setLocale, interfaceLocales, signOut } = useSession();
  const { tokens } = useBrand();
  const edition = useEdition();
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const open = useLocation().pathname === DOCUMENTS_PATH;
  const [still, setStill] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const documents = useRef<HTMLAnchorElement>(null);
  const rosette = useRef<SVGSVGElement>(null);
  const firstPart = useRef<HTMLAnchorElement>(null);
  const wasOpen = useRef(open);

  const style = useMemo(
    () => ({ ...toCssVariables(toDark(tokens)), ...roomCssVariables() }) as CSSProperties,
    [tokens],
  );

  /*
   * Arriving in the room is the arrival. The intro is mounted only where the rail is, so without
   * this it would first play over whichever part the person opened, one click later (§2).
   */
  useEffect(rememberIntroSeen, []);

  const documentsArt = () => documents.current?.querySelector('.catcher__art') ?? null;

  /** Opening zooms from the catcher, closing back into it; under reduced motion, a cut. */
  function go(to: string) {
    const from = to === DOCUMENTS_PATH ? documentsArt() : rosette.current;
    zoomFrom = reduced || !from ? null : from.getBoundingClientRect();
    void navigate(to);
  }

  useLayoutEffect(() => {
    const from = zoomFrom;
    zoomFrom = null;
    const target = open ? rosette.current : documentsArt();
    if (from && target && !reduced) zoom(target, from);
  }, [open, reduced]);

  /** An ordinary click zooms; a modified one (new tab, new window) is left to the browser. */
  function zoomTo(to: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      go(to);
    };
  }

  /* Focus follows the change, and the opening is said aloud; a first load moves nothing. */
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      firstPart.current?.focus();
      setAnnouncement(t('room.opened', { name: t('room.documents') }));
    } else {
      documents.current?.focus();
      setAnnouncement('');
    }
  }, [open, t]);

  /* Escape always lands: it closes the catcher from anywhere on the page. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') go(ROOM_PATH);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!user) return null;

  return (
    <div className={`room system${still ? ' room--still' : ''}`} style={style}>
      <header className="room__bar">
        <Wordmark name={organisation?.name ?? t('app.name')} />
        <span className="room__session">
          <LanguagePicker
            locales={interfaceLocales.supported}
            current={locale}
            onChange={setLocale}
            t={t}
          />
          <span className="room__who small">{user.name}</span>
          <button className="button button--quiet small" onClick={signOut}>
            {t('app.signOut')}
          </button>
        </span>
      </header>

      <main className="room__floor">
        <h1 className="visually-hidden">{t('app.name')}</h1>
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>

        {open ? (
          <section className="room__open" aria-labelledby="room-documents">
            <Link
              className="button button--quiet small room__back"
              to={ROOM_PATH}
              onClick={zoomTo(ROOM_PATH)}
            >
              <Icon name="arrow-left" className="icon--lead" />
              {t('room.back')}
            </Link>
            <h2 id="room-documents" className="room__title">
              {t('room.documents')}
            </h2>
            <div className="room__opened">
              <Rosette ref={rosette} />
              <Part area="forms" icon="forms" to="/forms" label={t('nav.forms')} ref={firstPart} />
              <Part area="scan" icon="upload" to="/forms?new" label={t('room.scan')} />
              <Part area="sign" icon="signature" to="/signing" label={t('room.sign')} />
              <Part
                area="send"
                icon="email"
                to={edition === 'desktop' ? '/outgoing' : null}
                label={t('room.send')}
                note={edition === 'server' ? t('room.centreNone') : null}
              />
              <p className="room__centre">
                <strong>{t('room.centre')}</strong>
                {edition !== null && (
                  <span>
                    {edition === 'desktop' ? t('room.centreLater') : t('room.centreNone')}
                  </span>
                )}
              </p>
            </div>
          </section>
        ) : (
          <>
            <ul className="room__catchers">
              <li>
                <a
                  ref={documents}
                  className="catcher catcher--gold catcher--documents"
                  href={DOCUMENTS_PATH}
                  onClick={zoomTo(DOCUMENTS_PATH)}
                >
                  <Catcher name={t('room.documents')} />
                </a>
              </li>
              <li className="catcher catcher--platinum catcher--idle">
                <Catcher name={t('room.spreadsheets')} note={t('room.notBuilt')} />
              </li>
              <li className="catcher catcher--bronze catcher--idle">
                <Catcher name={t('room.presentation')} note={t('room.notBuilt')} />
              </li>
            </ul>
            <button
              type="button"
              className="button button--quiet small room__pause"
              aria-pressed={still}
              onClick={() => setStill((value) => !value)}
            >
              {still ? t('room.play') : t('room.pause')}
            </button>
          </>
        )}
      </main>
    </div>
  );
}

/** One catcher: the mark, floating over its colour, and its name written beneath it. */
function Catcher({ name, note }: { name: string; note?: string }) {
  return (
    <>
      <span className="catcher__glow" aria-hidden="true" />
      <span className="catcher__art">
        <Mark />
      </span>
      <span className="catcher__name">{name}</span>
      {note && <span className="catcher__note small">{note}</span>}
    </>
  );
}

/**
 * One of the four parts, on its pocket of the opened catcher.
 *
 * A real link to the screen that does the work, never revealed by a class that script adds. Where
 * this edition has no such screen, it says so and is not a link.
 */
function Part({
  area,
  icon,
  to,
  label,
  note,
  ref,
}: {
  area: 'forms' | 'scan' | 'sign' | 'send';
  icon: IconName;
  to: string | null;
  label: string;
  note?: string | null;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const className = `room__part room__part--${area}`;
  if (to === null) {
    return (
      <span className={`${className} room__part--idle`}>
        <Icon name={icon} className="icon--lead" />
        <span>
          {label}
          {note && <span className="room__partNote small">{note}</span>}
        </span>
      </span>
    );
  }
  return (
    <Link ref={ref} className={className} to={to}>
      <Icon name={icon} className="icon--lead" />
      {label}
    </Link>
  );
}

const POCKETS = ['north', 'east', 'south', 'west'] as const satisfies readonly Facet['pocket'][];

/**
 * The opened catcher, drawn top-down from the mark's own geometry.
 *
 * The four pockets part from the centre on the brand's `unfurl` curve, which is how the paper
 * opens. The pose changes from the three-quarter still to top-down as it opens: the brand bundle
 * has no "opened into four" state, so code draws it until the brand designer does (§9).
 */
function Rosette({ ref }: { ref: Ref<SVGSVGElement> }) {
  return (
    <svg
      ref={ref}
      className="rosette"
      viewBox="-20 -20 140 140"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="rosette__heart" cx="50" cy="50" r="24" />
      {POCKETS.map((pocket) => (
        <g key={pocket} className={`rosette__pocket rosette__pocket--${pocket}`}>
          {FACETS.filter((facet) => facet.pocket === pocket).map((facet) => (
            <path
              key={facet.id}
              d={MARK[facet.id]}
              className={`rosette__facet rosette__facet--${facet.tone}`}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
