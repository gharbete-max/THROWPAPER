import { useState, type FormEvent, type ReactNode } from 'react';
import type { LoppaBridge, PanelSettings, PanelState, Result } from '../bridge.js';
import type { Messages } from '../messages.js';

interface Props {
  t: Messages;
  initial: PanelState;
  bridge: LoppaBridge;
}

export function Panel({ t, initial, bridge }: Props) {
  return initial.view === 'setup' ? (
    <Setup t={t} bridge={bridge} />
  ) : (
    <Settings t={t} bridge={bridge} initial={initial.settings} />
  );
}

function Setup({ t, bridge }: { t: Messages; bridge: LoppaBridge }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Result>) {
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) {
      setError(result.error === 'already-set-up' ? t.errorAlreadySetUp : result.error);
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() =>
      bridge.bootstrap({
        organisationName: String(data.get('organisationName') ?? ''),
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
      }),
    );
  }

  return (
    <main className="panel">
      <h1>{t.setupTitle}</h1>
      <p className="muted">{t.setupLead}</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            {t.setupOrganisation}
            <input type="text" name="organisationName" required autoFocus />
          </label>
          <label>
            {t.setupName}
            <input type="text" name="name" required autoComplete="name" />
          </label>
          <label>
            {t.setupEmail}
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <div className="actions">
            <button type="submit" className="primary">
              {busy ? t.setupWorking : t.setupStart}
            </button>
          </div>
        </fieldset>
      </form>
      <div className="actions">
        <span className="muted">{t.setupOrDemo}</span>
        <button type="button" disabled={busy} onClick={() => void run(() => bridge.loadDemo())}>
          {t.setupDemo}
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span>{children}</span>
    </label>
  );
}

function Settings({
  t,
  bridge,
  initial,
}: {
  t: Messages;
  bridge: LoppaBridge;
  initial: PanelSettings;
}) {
  const [settings, setSettings] = useState<PanelSettings>(initial);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const smtp = settings.mail.smtp ?? { host: '', port: 587, secure: false, hasPassword: false };
  const startsSending = initial.mail.mode !== 'smtp' && settings.mail.mode === 'smtp';

  function patch(next: Partial<PanelSettings>) {
    setSettings((current) => ({ ...current, ...next }));
  }
  function patchSmtp(next: Partial<typeof smtp>) {
    patch({ mail: { ...settings.mail, smtp: { ...smtp, ...next } } });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await bridge.saveSettings({
      settings,
      smtpPassword: password,
      confirmRealSending: confirm,
    });
    setBusy(false);
    setStatus(
      result.ok
        ? { ok: true, message: t.settingsSaved }
        : {
            ok: false,
            message: result.error === 'confirm-real-sending' ? t.mailConfirm : result.error,
          },
    );
    if (result.ok) setPassword('');
  }

  return (
    <main className="panel">
      <h1>{t.settingsTitle}</h1>
      <form onSubmit={(event) => void save(event)}>
        <fieldset>
          <legend>{t.mailHeading}</legend>
          <Choice
            name="mail"
            value="outbox"
            checked={settings.mail.mode === 'outbox'}
            onChange={() => patch({ mail: { ...settings.mail, mode: 'outbox' } })}
          >
            {t.mailOutbox}
          </Choice>
          <Choice
            name="mail"
            value="smtp"
            checked={settings.mail.mode === 'smtp'}
            onChange={() => patch({ mail: { ...settings.mail, mode: 'smtp', smtp } })}
          >
            {t.mailSmtp}
          </Choice>
          <label>
            {t.mailFrom}
            <input
              type="email"
              value={settings.mail.from}
              onChange={(event) => patch({ mail: { ...settings.mail, from: event.target.value } })}
            />
          </label>
          {settings.mail.mode === 'smtp' ? (
            <>
              <label>
                {t.smtpHost}
                <input
                  type="text"
                  required
                  value={smtp.host}
                  onChange={(event) => patchSmtp({ host: event.target.value })}
                />
              </label>
              <label>
                {t.smtpPort}
                <input
                  type="number"
                  value={smtp.port}
                  onChange={(event) => patchSmtp({ port: Number(event.target.value) })}
                />
              </label>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={smtp.secure}
                  onChange={(event) => patchSmtp({ secure: event.target.checked })}
                />
                <span>{t.smtpSecure}</span>
              </label>
              <label>
                {t.smtpUser}
                <input
                  type="text"
                  value={smtp.user ?? ''}
                  onChange={(event) => patchSmtp({ user: event.target.value })}
                />
              </label>
              <label>
                {t.smtpPassword}
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {smtp.hasPassword ? <p className="note">{t.smtpPasswordKept}</p> : null}
              {startsSending ? (
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(event) => setConfirm(event.target.checked)}
                  />
                  <span>{t.mailConfirm}</span>
                </label>
              ) : null}
            </>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>{t.aiHeading}</legend>
          <p className="note">{t.aiLead}</p>
          {(['off', 'online', 'cloud'] as const).map((mode) => (
            <Choice
              key={mode}
              name="ai"
              value={mode}
              checked={settings.ai.mode === mode}
              onChange={() => patch({ ai: { ...settings.ai, mode } })}
            >
              {mode === 'off' ? t.aiOff : mode === 'online' ? t.aiOnline : t.aiCloud}
            </Choice>
          ))}
          {settings.ai.mode === 'online' ? (
            <>
              <label>
                {t.aiEndpoint}
                <input
                  type="url"
                  value={settings.ai.endpoint ?? ''}
                  onChange={(event) =>
                    patch({ ai: { ...settings.ai, endpoint: event.target.value || undefined } })
                  }
                />
              </label>
              <p className="note">{t.placeholderNote}</p>
            </>
          ) : null}
          {settings.ai.mode === 'cloud' ? <p className="note">{t.cloudNote}</p> : null}
        </fieldset>

        <fieldset>
          <legend>{t.signingHeading}</legend>
          <p className="note">{t.signingLead}</p>
          {(['local', 'online', 'cloud'] as const).map((mode) => (
            <Choice
              key={mode}
              name="signing"
              value={mode}
              checked={settings.signing.mode === mode}
              onChange={() => patch({ signing: { ...settings.signing, mode } })}
            >
              {mode === 'local'
                ? t.signingLocal
                : mode === 'online'
                  ? t.signingOnline
                  : t.signingCloud}
            </Choice>
          ))}
          {settings.signing.mode === 'online' ? (
            <>
              <label>
                {t.signingEndpoint}
                <input
                  type="url"
                  value={settings.signing.endpoint ?? ''}
                  onChange={(event) =>
                    patch({
                      signing: { ...settings.signing, endpoint: event.target.value || undefined },
                    })
                  }
                />
              </label>
              <p className="note">{t.placeholderNote}</p>
            </>
          ) : null}
          {settings.signing.mode === 'cloud' ? <p className="note">{t.cloudNote}</p> : null}
        </fieldset>

        <fieldset>
          <legend>{t.pdfHeading}</legend>
          <label>
            {t.pdfBrowser}
            <input
              type="text"
              value={settings.pdfBrowserPath ?? ''}
              onChange={(event) => patch({ pdfBrowserPath: event.target.value || undefined })}
            />
          </label>
        </fieldset>

        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {t.settingsSave}
          </button>
          <button type="button" onClick={() => bridge.closePanel()}>
            {t.settingsCancel}
          </button>
        </div>
        {status ? (
          <p className={status.ok ? 'ok' : 'error'} role="status">
            {status.message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
