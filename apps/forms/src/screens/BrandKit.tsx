import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkContrast, defaultTokens, toCssBlock, type TokenSet } from '@tp/tokens';
import { client, type BrandKitResponse } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.js';
import { useBrand } from '../lib/brand.js';
import { ImagePicker } from '../components/ImagePicker.js';
import { dominantColour } from '../lib/dominant-colour.js';

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

/**
 * Every length in the token set, as a slider.
 *
 * A number box asks somebody to guess what 6 looks like; a slider with a live preview beside it
 * lets them find the answer by moving it. The bounds are what keeps the form usable — a 40px
 * radius is a pill and a 0px one is a box, but a 200px one is a shape nobody chose on purpose.
 */
const LENGTHS: ReadonlyArray<{
  key: 'radius' | 'borderWidth' | 'spacingUnit' | 'controlHeight' | 'contentWidth';
  min: number;
  max: number;
  hint?: string;
}> = [
  { key: 'radius', min: 0, max: 20 },
  { key: 'borderWidth', min: 0, max: 4 },
  { key: 'spacingUnit', min: 4, max: 16, hint: 'brand.spacingHint' },
  { key: 'controlHeight', min: 32, max: 64, hint: 'brand.controlHeightHint' },
  { key: 'contentWidth', min: 360, max: 1000, hint: 'brand.contentWidthHint' },
];

/**
 * Fonts that are already on the machine.
 *
 * No web fonts: a downloaded typeface means a request before the form can be read, a flash of
 * unstyled text, and a third party told about every visitor. These stacks all resolve to
 * something installed, which is why the form appears immediately.
 */
const FONT_STACKS = [
  'Inter, system-ui, sans-serif',
  'system-ui, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Segoe UI", Roboto, sans-serif',
  '"Helvetica Neue", Arial, sans-serif',
  'ui-monospace, "Cascadia Mono", Menlo, monospace',
];

function Slider({
  label,
  hint,
  min,
  max,
  step = 1,
  suffix = 'px',
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field brand__slider">
      <span className="row row--between">
        {label}
        <span className="small muted">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

export function BrandKit() {
  const t = useT();
  const { user } = useSession();
  const { refresh } = useBrand();
  const [tokens, setTokens] = useState<TokenSet>(defaultTokens);
  const [saved, setSaved] = useState<BrandKitResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);

  /**
   * Reads the colour a logo is mostly made of, so the buttons can match it instead of staying the
   * blue this product shipped with. Silent on failure — a greyscale mark has no answer to give,
   * and a wrong colour is worse than no suggestion.
   */
  async function suggestFromLogo(path: string) {
    const found = await dominantColour(path);
    // A colour that is barely present is a stray pixel, not the brand.
    if (found && found.share > 0.12) setSuggested(found.hex);
  }

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
          <h2 className="small">{t('brand.logo')}</h2>
          <ImagePicker
            value={tokens.logoLight}
            disabled={readOnly}
            onChange={(path) => {
              setTokens((current) => ({ ...current, logoLight: path }));
              setSuggested(null);
              if (path) void suggestFromLogo(path);
            }}
          />

          {/*
            Offered, not imposed. Reading a colour out of a logo is a guess — a good one, but a
            guess — and silently repainting somebody's product the moment they upload a file is
            the kind of helpfulness that feels like a bug. One click applies it; ignoring it costs
            nothing.
          */}
          {suggested && (
            <div className="row row--between brand__suggestion">
              <span className="row">
                <span
                  className="brand__swatch"
                  style={{ background: suggested }}
                  aria-hidden="true"
                />
                <span className="small">{t('brand.logoColour')}</span>
              </span>
              <button
                type="button"
                className="button button--quiet small"
                onClick={() => {
                  setTokens((current) => ({
                    ...current,
                    colour: { ...current.colour, primary: suggested },
                  }));
                  setSuggested(null);
                }}
              >
                {t('brand.logoColourApply')}
              </button>
            </div>
          )}

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

          {LENGTHS.map(({ key, min, max, hint }) => (
            <Slider
              key={key}
              label={t(`brand.${key}`)}
              hint={hint ? t(hint) : undefined}
              min={min}
              max={max}
              value={Number.parseFloat(tokens[key]) || min}
              disabled={readOnly}
              onChange={(value) => setTokens((current) => ({ ...current, [key]: `${value}px` }))}
            />
          ))}

          <h2 className="small">{t('brand.type')}</h2>

          <label className="field">
            <span>{t('brand.bodyFont')}</span>
            <select
              value={tokens.typography.bodyFont}
              disabled={readOnly}
              onChange={(event) =>
                setTokens((current) => ({
                  ...current,
                  typography: {
                    ...current.typography,
                    bodyFont: event.target.value,
                    headingFont: event.target.value,
                  },
                }))
              }
            >
              {FONT_STACKS.map((stack) => (
                <option key={stack} value={stack}>
                  {stack.split(',')[0]}
                </option>
              ))}
            </select>
          </label>

          <Slider
            label={t('brand.baseSize')}
            min={12}
            max={22}
            value={Number.parseFloat(tokens.typography.baseSize) || 16}
            disabled={readOnly}
            onChange={(value) =>
              setTokens((current) => ({
                ...current,
                typography: { ...current.typography, baseSize: `${value}px` },
              }))
            }
          />

          <Slider
            label={t('brand.lineHeight')}
            min={1.1}
            max={2}
            step={0.05}
            suffix=""
            value={tokens.typography.lineHeight}
            disabled={readOnly}
            onChange={(value) =>
              setTokens((current) => ({
                ...current,
                typography: { ...current.typography, lineHeight: value },
              }))
            }
          />

          <Slider
            label={t('brand.scaleRatio')}
            min={1}
            max={1.6}
            step={0.05}
            suffix=""
            hint={t('brand.scaleRatioHint')}
            value={tokens.typography.scaleRatio}
            disabled={readOnly}
            onChange={(value) =>
              setTokens((current) => ({
                ...current,
                typography: { ...current.typography, scaleRatio: value },
              }))
            }
          />

          <h2 className="small">{t('brand.labels')}</h2>

          <div className="row brand__styleRow">
            <button
              type="button"
              className={
                tokens.typography.labelWeight >= 600
                  ? 'button button--icon small'
                  : 'button button--quiet button--icon small'
              }
              disabled={readOnly}
              aria-pressed={tokens.typography.labelWeight >= 600}
              title={t('brand.bold')}
              aria-label={t('brand.bold')}
              onClick={() =>
                setTokens((current) => ({
                  ...current,
                  typography: {
                    ...current.typography,
                    labelWeight: current.typography.labelWeight >= 600 ? 400 : 700,
                  },
                }))
              }
            >
              <strong>B</strong>
            </button>

            <button
              type="button"
              className={
                tokens.typography.labelStyle === 'italic'
                  ? 'button button--icon small'
                  : 'button button--quiet button--icon small'
              }
              disabled={readOnly}
              aria-pressed={tokens.typography.labelStyle === 'italic'}
              title={t('brand.italic')}
              aria-label={t('brand.italic')}
              onClick={() =>
                setTokens((current) => ({
                  ...current,
                  typography: {
                    ...current.typography,
                    labelStyle: current.typography.labelStyle === 'italic' ? 'normal' : 'italic',
                  },
                }))
              }
            >
              <em>I</em>
            </button>

            <button
              type="button"
              className={
                tokens.typography.labelDecoration === 'underline'
                  ? 'button button--icon small'
                  : 'button button--quiet button--icon small'
              }
              disabled={readOnly}
              aria-pressed={tokens.typography.labelDecoration === 'underline'}
              title={t('brand.underline')}
              aria-label={t('brand.underline')}
              onClick={() =>
                setTokens((current) => ({
                  ...current,
                  typography: {
                    ...current.typography,
                    labelDecoration:
                      current.typography.labelDecoration === 'underline' ? 'none' : 'underline',
                  },
                }))
              }
            >
              <u>U</u>
            </button>
          </div>
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
