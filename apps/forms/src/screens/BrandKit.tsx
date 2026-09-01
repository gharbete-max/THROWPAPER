import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkContrast, defaultTokens, toCssBlock, type TokenSet } from '@tp/tokens';
import { client, type BrandKitResponse } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useBrand } from '../lib/brand.js';

/**
 * The Brand Kit editor.
 *
 * Two decisions shape this screen. Contrast is checked as you type rather than on save, because a
 * warning that appears after you have committed is a reprimand, not help. And the preview is the
 * product's own components under the chosen tokens, not a row of colour swatches — swatches always
 * look fine, and the question being asked is whether the *form* is readable.
 */

/** The colours worth putting in front of somebody, in the order they matter. */
const COLOUR_FIELDS = [
  { key: 'primary', hint: 'brand.hint.primary' },
  { key: 'background', hint: 'brand.hint.background' },
  { key: 'surface', hint: 'brand.hint.surface' },
  { key: 'text', hint: 'brand.hint.text' },
  { key: 'muted', hint: 'brand.hint.muted' },
  { key: 'border', hint: 'brand.hint.border' },
  { key: 'secondary', hint: 'brand.hint.secondary' },
  { key: 'accent', hint: 'brand.hint.accent' },
  { key: 'success', hint: 'brand.hint.success' },
  { key: 'warning', hint: 'brand.hint.warning' },
  { key: 'danger', hint: 'brand.hint.danger' },
] as const;

type ColourKey = (typeof COLOUR_FIELDS)[number]['key'];

export function BrandKit() {
  const t = useT();
  const { user } = useSession();
  const { refresh } = useBrand();
  const [tokens, setTokens] = useState<TokenSet>(defaultTokens);
  const [saved, setSaved] = useState<BrandKitResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const readOnly = user?.role !== 'admin';

  useEffect(() => {
    client
      .brandKit()
      .then((response) => {
        setSaved(response);
        setTokens(response.tokens);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  /** Checked here as well as on the server, so the warning moves as the colour does. */
  const warnings = useMemo(() => checkContrast(tokens), [tokens]);

  const dirty = useMemo(
    () => JSON.stringify(tokens) !== JSON.stringify(saved?.tokens ?? defaultTokens),
    [tokens, saved],
  );

  const setColour = useCallback((key: ColourKey, value: string) => {
    setTokens((current) => ({ ...current, colour: { ...current.colour, [key]: value } }));
  }, []);

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const response = await client.saveBrandKit(tokens);
      setSaved(response);
      setTokens(response.tokens);
      setStatus('ready');
      // The chrome around this screen is painted from the same kit, so it updates immediately.
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus('ready');
    }
  }

  async function reset() {
    setStatus('saving');
    try {
      const response = await client.resetBrandKit();
      setSaved(response);
      setTokens(response.tokens);
      setStatus('ready');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus('ready');
    }
  }

  if (status === 'loading') return <p className="muted">{t('app.loading')}</p>;
  if (status === 'error') return <p className="status-down">{t('brand.loadFailed')}</p>;

  return (
    <div className="stack">
      <div className="row row--between">
        <h1>{t('brand.title')}</h1>
        <div className="row">
          {!readOnly && saved?.customised && (
            <button
              type="button"
              className="secondary"
              onClick={reset}
              disabled={status === 'saving'}
            >
              {t('brand.reset')}
            </button>
          )}
          {!readOnly && (
            <button type="button" onClick={save} disabled={!dirty || status === 'saving'}>
              {status === 'saving' ? t('brand.saving') : t('brand.save')}
            </button>
          )}
        </div>
      </div>

      <p className="muted small">{t('brand.intro')}</p>
      {readOnly && <p className="small muted">{t('brand.readOnly')}</p>}
      {error && <p className="status-down">{error}</p>}

      <div className="brand">
        <div className="stack">
          <h2 className="small">{t('brand.colours')}</h2>

          {COLOUR_FIELDS.map(({ key, hint }) => (
            <ColourRow
              key={key}
              label={t(`brand.colour.${key}`)}
              hint={t(hint)}
              value={tokens.colour[key]}
              disabled={readOnly}
              onChange={(value) => setColour(key, value)}
            />
          ))}

          <h2 className="small">{t('brand.shape')}</h2>

          <label className="field">
            <span>{t('brand.radius')}</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              disabled={readOnly}
              value={Number.parseFloat(tokens.radius) || 0}
              onChange={(event) =>
                setTokens((current) => ({ ...current, radius: `${event.target.value}px` }))
              }
            />
            <span className="small muted">{tokens.radius}</span>
          </label>

          <label className="field">
            <span>{t('brand.baseSize')}</span>
            <input
              type="range"
              min={14}
              max={20}
              step={1}
              disabled={readOnly}
              value={Number.parseFloat(tokens.typography.baseSize) || 16}
              onChange={(event) =>
                setTokens((current) => ({
                  ...current,
                  typography: { ...current.typography, baseSize: `${event.target.value}px` },
                }))
              }
            />
            <span className="small muted">{tokens.typography.baseSize}</span>
          </label>
        </div>

        <div className="stack">
          <h2 className="small">{t('brand.preview')}</h2>
          <Preview tokens={tokens} t={t} />

          <h2 className="small">{t('brand.contrast')}</h2>
          {warnings.length === 0 ? (
            <p className="small status-up">{t('brand.contrastOk')}</p>
          ) : (
            <ul className="stack small">
              {warnings.map((warning) => (
                <li key={`${warning.token}-${warning.against}`} className="muted">
                  <strong>{warning.token}</strong> — {warning.ratio}:1, {t('brand.contrastNeeds')}{' '}
                  {warning.required}:1
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">{t('brand.contrastAdvisory')}</p>
        </div>
      </div>
    </div>
  );
}

function ColourRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field brand__colour">
      <span>{label}</span>
      <span className="row">
        {/* The picker for choosing, the text box for pasting the hex off a brand sheet. */}
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      <span className="small muted">{hint}</span>
    </label>
  );
}

/**
 * The product's own components under the candidate tokens.
 *
 * Rendered inside a scoped style block rather than by swapping the page's variables, so a colour
 * being tried out cannot make the editor itself unreadable while it is being tried.
 */
function Preview({ tokens, t }: { tokens: TokenSet; t: (key: string) => string }) {
  const css = useMemo(() => toCssBlock(tokens).replace(/^:root/m, '.brand__preview'), [tokens]);

  return (
    <>
      <style>{css}</style>
      <div className="brand__preview">
        <div className="brand__preview-inner">
          <h3>{t('brand.previewHeading')}</h3>
          <p className="muted small">{t('brand.previewBody')}</p>

          <label className="field">
            <span>{t('brand.previewField')}</span>
            <input type="text" defaultValue="Åsa Öqvist" />
          </label>

          <fieldset className="choice choice--cards">
            <legend>{t('brand.previewChoice')}</legend>
            <div className="choice__options">
              <label className="choice__option">
                <input type="radio" name="brand-preview" defaultChecked readOnly />
                <span>{t('brand.previewOptionA')}</span>
              </label>
              <label className="choice__option">
                <input type="radio" name="brand-preview" readOnly />
                <span>{t('brand.previewOptionB')}</span>
              </label>
            </div>
          </fieldset>

          <div className="row">
            <button type="button">{t('brand.previewSubmit')}</button>
            <button type="button" className="secondary">
              {t('brand.previewSecondary')}
            </button>
          </div>

          <p className="small status-down">{t('brand.previewError')}</p>
        </div>
      </div>
    </>
  );
}
