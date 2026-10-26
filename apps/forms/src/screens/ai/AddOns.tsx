import { useCallback, useEffect, useState } from 'react';
import {
  GRAPHICS_INSTALL_ID,
  type AddonTask,
  type AddonsBridge,
  type AddonsProblem,
  type AddonsStart,
  type AddonsStatus,
  type AiBridge,
  type AiConsent,
  type AiGraphics,
  type UpdateCheck,
  type UpdateProblem,
} from '@tp/shared/ai';
import { useConfirm } from '../../components/Confirm.js';
import { addonsBridge } from '../../lib/addons-bridge.js';
import { aiBridge } from '../../lib/ai-bridge.js';
import { useT } from '../../lib/i18n.js';

const MB = 1000 ** 2;
const GB = 1000 ** 3;
const mb = (bytes: number) => String(Math.round(bytes / MB));

/**
 * "Add-ons and updates" (ADR 0026, amended): everything optional that is not in the installer, in
 * one place inside the app, each with a button, a plain description, its size and a confirmation
 * that names the host. Nothing is fetched or checked on its own: every network use starts with a
 * press and a confirmation (CLAUDE.md rule 7).
 *
 * The AI model has its own card above (the recommended one, one button). Here: the program that
 * runs the model, the graphics-card program, the AI pack for offline installs, and the update
 * check, which fetches nothing but the list of releases and then, if the person asks, the installer
 * for this computer, checked against the release's published checksums before it can be opened.
 */
export function AddOns() {
  const bridge = addonsBridge();
  return bridge ? <Rows bridge={bridge} ai={aiBridge()} /> : null;
}

type Working = AddonTask | 'graphics' | 'checking' | null;

function Rows({ bridge, ai }: { bridge: AddonsBridge; ai: AiBridge | null }) {
  const t = useT();
  const confirm = useConfirm();
  const [status, setStatus] = useState<AddonsStatus | null>(null);
  const [graphics, setGraphics] = useState<AiGraphics | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [working, setWorking] = useState<Working>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);

  const refresh = useCallback(() => {
    void bridge.status().then(setStatus);
    void ai?.status().then((s) => {
      setGraphics(s.graphics ?? null);
      setAiBusy(s.activity !== 'idle');
    });
  }, [bridge, ai]);
  useEffect(refresh, [refresh]);

  const say = useCallback(
    (p: AddonsProblem | UpdateProblem) => {
      const own = ['not-the-listed-file', 'no-disk-space', 'offline', 'rate-limited'];
      const shared = ['busy', 'download-failed', 'cancelled'];
      setProblem(
        t(
          own.includes(p)
            ? `addons.problem.${p}`
            : `summary.problem.${shared.includes(p) ? p : 'failed'}`,
        ),
      );
    },
    [t],
  );

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.kind === 'progress') setProgress({ done: event.done, total: event.total });
      else {
        setProgress(null);
        setWorking(null);
        if (event.kind === 'done') {
          setProblem(null);
          setStatus(event.status);
        } else say(event.problem);
        refresh();
      }
    });
    // The graphics-card program is fetched by the AI coordinator; its events come on that bridge.
    const offAi = ai?.onEvent((event) => {
      if (event.id !== GRAPHICS_INSTALL_ID) return;
      if (event.kind === 'install') setProgress({ done: event.modelDone, total: event.modelTotal });
      if (event.kind === 'installed' || event.kind === 'install-failed') {
        setProgress(null);
        setWorking(null);
        if (event.kind === 'install-failed') say(event.problem as AddonsProblem);
        refresh();
      }
    });
    return () => {
      off();
      offAi?.();
    };
  }, [bridge, ai, say, refresh]);

  if (!status) return null;
  const idle = working === null && !aiBusy;

  /** Ask first, naming the host, the files and the size; only a yes starts the fetch. */
  async function fetchWith(
    task: Working,
    what: string,
    consent: AiConsent,
    start: (consent: AiConsent) => Promise<AddonsStart>,
  ) {
    const yes = await confirm(
      t('addons.getConfirm', {
        what,
        host: consent.host,
        files: consent.files.join(', '),
        size: mb(consent.totalBytes),
      }),
      { confirmLabel: t('ai.models.getConfirmYes'), danger: false },
    );
    if (!yes) return;
    setProblem(null);
    setWorking(task);
    setProgress({ done: 0, total: consent.totalBytes });
    const result = await start(consent);
    if (!result.ok) {
      setWorking(null);
      setProgress(null);
      say(result.problem);
    }
  }

  async function getGraphics(g: AiGraphics) {
    if (!ai || !g.consent) return;
    const consent = g.consent;
    const yes = await confirm(
      t('ai.graphics.getConfirm', {
        host: consent.host,
        files: consent.files.join(', '),
        size: mb(consent.totalBytes),
        folder: g.folder,
      }),
      { confirmLabel: t('ai.graphics.getConfirmYes'), danger: false },
    );
    if (!yes) return;
    setProblem(null);
    setWorking('graphics');
    setProgress({ done: 0, total: consent.totalBytes });
    const result = await ai.installGraphics(consent);
    if (!result.ok) {
      setWorking(null);
      setProgress(null);
      say(result.problem as AddonsProblem);
    }
  }

  async function check() {
    const yes = await confirm(
      t('addons.update.checkConfirm', { host: status!.update.consent.host }),
      { confirmLabel: t('addons.update.checkYes'), danger: false },
    );
    if (!yes) return;
    setProblem(null);
    setUpdate(null);
    setWorking('checking');
    const result = await bridge.checkUpdate(status!.update.consent);
    setWorking(null);
    if (result.ok) setUpdate(result);
    else say(result.problem);
  }

  async function open() {
    if (!(await bridge.openInstaller()).ok) say('failed');
  }

  const { program, pack } = status;
  const found = update?.ok ? update : null;
  const saved = status.update.downloaded !== null;
  // What to do with the file, where that is not just "run it".
  const howTo =
    status.platform === 'darwin'
      ? t('addons.update.mac')
      : status.update.portable
        ? t('addons.update.portable')
        : null;
  const row = (
    key: string,
    name: string,
    note: string,
    extra: React.ReactNode,
    action: React.ReactNode,
  ) => (
    <li className="addon" key={key} data-addon={key}>
      <div className="addon__text stack stack--tight">
        <strong>{name}</strong>
        <p className="muted small">{note}</p>
        {extra}
      </div>
      {action}
    </li>
  );
  const button = (label: string, onClick: () => void, quiet = false) => (
    <button
      type="button"
      className={quiet ? 'button button--quiet' : 'button'}
      disabled={!idle}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const done = (text: string) => (
    <p className="small" role="status">
      {text}
    </p>
  );

  return (
    <section className="card stack" aria-labelledby="addons-more" data-addons>
      <h2 id="addons-more">{t('addons.more')}</h2>
      <ul className="addons" role="list">
        {row(
          'program',
          t('addons.program'),
          t('addons.program.note'),
          <>
            {program.state === 'included' ? done(t('addons.program.included')) : null}
            {program.state === 'installed' ? done(t('addons.there')) : null}
            {program.state === 'unavailable' ? done(t('addons.program.none')) : null}
            {program.state !== 'unavailable' && !program.tested ? (
              <p className="status-warning small">{t('addons.untested')}</p>
            ) : null}
          </>,
          program.state === 'missing' && program.consent
            ? button(
                t('addons.program.get'),
                () =>
                  void fetchWith(
                    'program',
                    t('addons.program'),
                    program.consent!,
                    bridge.installProgram,
                  ),
              )
            : null,
        )}
        {graphics && graphics.support !== 'none'
          ? row(
              'graphics',
              t('addons.graphics'),
              t('addons.graphics.note'),
              graphics.support === 'later'
                ? done(t('ai.graphics.later'))
                : graphics.present
                  ? done(t('addons.there'))
                  : null,
              graphics.support === 'available' && !graphics.present && graphics.consent
                ? button(t('addons.graphics.get'), () => void getGraphics(graphics))
                : null,
            )
          : null}
        {row(
          'pack',
          t('addons.pack'),
          t('addons.pack.note'),
          pack.state === 'present' ? done(t('addons.pack.there')) : null,
          pack.state === 'missing' && pack.consent
            ? button(
                t('addons.pack.get', { size: (pack.bytes / GB).toFixed(1) }),
                () => void fetchWith('pack', t('addons.pack'), pack.consent!, bridge.installPack),
              )
            : null,
        )}
        {row(
          'update',
          t('addons.update'),
          t('addons.update.note', { version: status.version }),
          <>
            {found ? (
              <div className="stack stack--tight" role="status">
                <p>
                  <strong>
                    {found.newer && found.latest
                      ? t('addons.update.available', { latest: found.latest })
                      : t('addons.update.newest')}
                  </strong>
                </p>
                {found.newer && found.notes ? (
                  <>
                    <p className="muted small">{t('addons.update.notes')}</p>
                    <p className="addon__notes small">{found.notes}</p>
                  </>
                ) : null}
                {found.newer && !found.installer ? (
                  <p className="small">{t('addons.update.none')}</p>
                ) : null}
              </div>
            ) : null}
            {found?.newer && found.installer ? (
              <div className="row">
                {button(
                  t('addons.update.get', { size: mb(found.installer.bytes) }),
                  () =>
                    void fetchWith(
                      'installer',
                      t('addons.update'),
                      found.installer!.consent,
                      bridge.downloadInstaller,
                    ),
                )}
              </div>
            ) : null}
            {saved ? (
              <div className="stack stack--tight">
                {done(t('addons.update.saved'))}
                {howTo ? <p className="muted small">{howTo}</p> : null}
                <div className="row">{button(t('addons.update.open'), () => void open())}</div>
              </div>
            ) : null}
          </>,
          button(t('addons.update.check'), () => void check(), true),
        )}
      </ul>
      {progress ? (
        <div className="stack">
          <progress value={progress.done} max={progress.total} aria-label={t('addons.more')} />
          <p className="small" aria-live="polite">
            {t('addons.progress', { done: mb(progress.done), total: mb(progress.total) })}
          </p>
          <button
            type="button"
            className="button button--quiet"
            onClick={() =>
              void (working === 'graphics' ? ai?.cancel(GRAPHICS_INSTALL_ID) : bridge.cancel())
            }
          >
            {t('summary.cancel')}
          </button>
        </div>
      ) : null}
      {working === 'checking' ? (
        <p className="small" aria-live="polite">
          {t('app.loading')}
        </p>
      ) : null}
      {problem ? (
        <p className="status-down" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
