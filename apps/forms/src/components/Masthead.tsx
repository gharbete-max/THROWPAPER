import type { ReactNode } from 'react';
import type { LogoSlot } from '@tp/shared/forms';

/**
 * The top of a published form — whose it is, and what it is — laid out by the form's logo slot
 * (`FormSettings.layout.logoSlot`; `docs/plan/DESIGN-LANGUAGE.md`, "Placement slots").
 *
 * One component for the public page and the builder's preview, so the preview cannot show a
 * layout the page does not have (`docs/plan/CAVEATS.md` #31). A slot is a name, never a position:
 * each is laid out by the stylesheet, differently on a phone and on a wide screen.
 *
 * **No slot** renders exactly the header every form had before slots existed — the logo (or the
 * organisation's name) at the start, the corner control at the end, the title under them.
 */

export interface MastheadProps {
  readonly slot: LogoSlot | undefined;
  /** The organisation's logo, or null to say its name instead. */
  readonly logo: string | null;
  readonly organisationName: string;
  /** The form's title; empty for none. */
  readonly title: string;
  /** What sits at the top end: the form's own language switcher. */
  readonly corner?: ReactNode;
}

/** The logo, or the name where there is none. The name is the alt text: a logo says who this is. */
function Mark({ logo, organisationName }: Pick<MastheadProps, 'logo' | 'organisationName'>) {
  return logo ? (
    <img className="brand-mark" src={logo} alt={organisationName} />
  ) : (
    <strong>{organisationName}</strong>
  );
}

export function Masthead({ slot, logo, organisationName, title, corner }: MastheadProps) {
  const mark = <Mark logo={logo} organisationName={organisationName} />;
  const heading = title ? <h1 className="public__title">{title}</h1> : null;

  switch (slot) {
    case undefined:
      return (
        <>
          <header className="row row--between">
            {mark}
            {corner}
          </header>
          {heading}
        </>
      );
    case 'header-left':
      return (
        <header className="masthead masthead--header-left">
          {mark}
          {heading}
          {corner}
        </header>
      );
    case 'masthead-centred':
      return (
        <header className="masthead masthead--masthead-centred">
          <div className="masthead__corner">{corner}</div>
          {mark}
          {heading}
        </header>
      );
    case 'corner-watermark':
      return (
        <>
          <header className="masthead masthead--corner-watermark">
            {corner}
            <span className="masthead__watermark">{mark}</span>
          </header>
          {heading}
        </>
      );
    case 'sidebar-rail':
      return (
        <>
          <header className="masthead masthead--sidebar-rail">
            <span className="masthead__rail">{mark}</span>
            {corner}
          </header>
          {heading}
        </>
      );
    // The logo is not in the header for these two: it is at the foot, or on the card.
    case 'footer-strip':
    case 'card-top':
      return (
        <>
          <header className="masthead masthead--bare">{corner}</header>
          {slot === 'card-top' && <div className="masthead__card-top">{mark}</div>}
          {heading}
        </>
      );
  }
}

/** The strip at the foot of a form whose slot is `footer-strip`; nothing for any other slot. */
export function MastheadFoot({
  slot,
  logo,
  organisationName,
}: Pick<MastheadProps, 'slot' | 'logo' | 'organisationName'>) {
  if (slot !== 'footer-strip') return null;
  return (
    <footer className="masthead-foot">
      <Mark logo={logo} organisationName={organisationName} />
      {/* The name beside a logo; a name alone is already said once. */}
      {logo && <span>{organisationName}</span>}
    </footer>
  );
}

/** The class the page takes for a slot that shapes the whole page (the card, the rail). */
export function mastheadPageClass(slot: LogoSlot | undefined): string {
  return slot ? ` masthead-page--${slot}` : '';
}
