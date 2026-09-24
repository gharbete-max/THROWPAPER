import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@tp/api-forms/desktop';
import { applySettingsForm, toPanelSettings } from './settings-form.js';
import type { SettingsForm } from '../bridge.js';

const protect = (plain: string) => `protected(${plain})`;

function smtpForm(
  overrides: { smtpPassword?: string; confirmRealSending?: boolean } = {},
): SettingsForm {
  const panel = toPanelSettings(defaultSettings());
  return {
    settings: {
      ...panel,
      mail: {
        mode: 'smtp',
        from: 'anmalan@example.com',
        smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'u', hasPassword: false },
      },
    },
    smtpPassword: overrides.smtpPassword ?? 'hemligt',
    confirmRealSending: overrides.confirmRealSending ?? true,
  };
}

describe('applying the settings form', () => {
  it('refuses to leave test mode without the confirmation (rule 7)', () => {
    const result = applySettingsForm(
      defaultSettings(),
      smtpForm({ confirmRealSending: false }),
      protect,
    );
    expect(result).toEqual({ ok: false, error: 'confirm-real-sending' });
  });

  it('stores the password only through the OS store, and never shows it to the panel', () => {
    const result = applySettingsForm(defaultSettings(), smtpForm(), protect);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.mail.smtp?.passwordProtected).toBe('protected(hemligt)');
    expect(JSON.stringify(result.settings)).not.toContain('"hemligt"');

    const panel = toPanelSettings(result.settings);
    expect(panel.mail.smtp?.hasPassword).toBe(true);
    expect(JSON.stringify(panel)).not.toContain('protected(');
  });

  it('keeps the stored password when the field is left empty, with no second confirmation', () => {
    const first = applySettingsForm(defaultSettings(), smtpForm(), protect);
    if (!first.ok) throw new Error('setup failed');
    const second = applySettingsForm(
      first.settings,
      smtpForm({ smtpPassword: '', confirmRealSending: false }),
      protect,
    );
    expect(second.ok && second.settings.mail.smtp?.passwordProtected).toBe('protected(hemligt)');
  });

  it('records the AI and signing choices, cloud placeholders included', () => {
    const form = smtpForm();
    form.settings = {
      ...toPanelSettings(defaultSettings()),
      ai: { mode: 'cloud' },
      signing: { mode: 'online', endpoint: 'https://sign.example.com' },
    };
    const result = applySettingsForm(defaultSettings(), form, protect);
    expect(result.ok && result.settings.ai.mode).toBe('cloud');
    expect(result.ok && result.settings.signing.endpoint).toBe('https://sign.example.com');
  });

  it('names the field that did not validate', () => {
    const form = smtpForm();
    form.settings.signing = { mode: 'online', endpoint: 'not a url' };
    const result = applySettingsForm(defaultSettings(), form, protect);
    expect(result).toEqual({ ok: false, error: 'signing.endpoint' });
  });
});

describe('switching between senders', () => {
  it('needs the confirmation again for Outlook, even coming from SMTP', () => {
    const onSmtp = applySettingsForm(defaultSettings(), smtpForm(), protect);
    if (!onSmtp.ok) throw new Error('setup failed');
    const toOutlook: SettingsForm = {
      settings: {
        ...toPanelSettings(onSmtp.settings),
        mail: { mode: 'outlook', from: 'a@example.com' },
      },
      smtpPassword: '',
      confirmRealSending: false,
    };
    expect(applySettingsForm(onSmtp.settings, toOutlook, protect)).toEqual({
      ok: false,
      error: 'confirm-real-sending',
    });
    const confirmed = applySettingsForm(
      onSmtp.settings,
      { ...toOutlook, confirmRealSending: true },
      protect,
    );
    expect(confirmed.ok && confirmed.settings.mail.mode).toBe('outlook');
  });

  it('goes back to test mode without asking', () => {
    const onSmtp = applySettingsForm(defaultSettings(), smtpForm(), protect);
    if (!onSmtp.ok) throw new Error('setup failed');
    const back = applySettingsForm(
      onSmtp.settings,
      {
        settings: {
          ...toPanelSettings(onSmtp.settings),
          mail: { mode: 'outbox', from: 'a@example.com' },
        },
        smtpPassword: '',
        confirmRealSending: false,
      },
      protect,
    );
    expect(back.ok && back.settings.mail.mode).toBe('outbox');
  });
});
