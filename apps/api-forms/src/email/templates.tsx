import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { toEmailStyles, type TokenSet } from '@tp/tokens';

/**
 * The transactional emails.
 *
 * Every style here comes from `toEmailStyles()` — phase 1's email compiler, used for real for the
 * first time. Nothing hard-codes a colour, so a Brand Kit change reaches these without them
 * knowing anything about it (CLAUDE.md rule 4).
 *
 * These components lived in `scripts/proof/` since phase 1. 3a said they would move when something
 * real needed them; this is that.
 */
export interface ConfirmationContent {
  /**
   * BCP-47, for the `lang` attribute on the document.
   *
   * Both templates hard-coded `lang="sv"` while their content was passed in already translated, so
   * a Japanese confirmation went out declared as Swedish. That is not cosmetic: `lang` is what a
   * screen reader uses to choose a voice and what a client uses to decide whether to offer a
   * translation, and getting it wrong makes an email that is read aloud incomprehensible.
   */
  lang: string;
  heading: string;
  intro: string;
  eventName: string;
  when: string;
  where: string;
  referenceLabel: string;
  reference: string;
  attachmentNote: string;
  footer: string;
  webVersionLabel: string;
  webVersionUrl: string;
  /**
   * The organisation's logo, absolute, or null.
   *
   * Absolute because an email has no page to resolve a path against — a relative `src` in a mail
   * client is a broken image every time. Null when they have not uploaded one, or when the format
   * is one mail clients cannot be trusted with: see `mailSafeLogo` in `send-job.ts`.
   */
  logoUrl: string | null;
  /**
   * What the logo says when it does not load, which is often.
   *
   * A good proportion of recipients block images by default and see `alt` and nothing else, so this
   * is the organisation's name rather than the word "logo". Same reasoning as the name in the
   * footer: the email has to say who sent it without loading anything.
   */
  logoAlt: string;
}

export function ConfirmationEmail({
  tokens,
  content,
}: {
  tokens: TokenSet;
  content: ConfirmationContent;
}) {
  const s = toEmailStyles(tokens);

  return (
    <Html lang={content.lang}>
      <Head />
      <Preview>{content.heading}</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.cell}>
            <Section style={s.card}>
              {/*
                On the confirmation only. The notification goes to the organisation's own operator,
                who does not need to be told which organisation they work for.

                Height and no width: a width would decide the aspect ratio of a file whose shape is
                the customer's, and a squashed logo is worse than a small one. 40 because this sits
                above the heading rather than instead of it — a confirmation, not a brochure.
              */}
              {content.logoUrl && (
                <Img src={content.logoUrl} alt={content.logoAlt} height="40" style={s.logo} />
              )}
              <Text style={s.heading}>{content.heading}</Text>
              <Text style={s.text}>{content.intro}</Text>

              <Text style={s.text}>
                <strong>{content.eventName}</strong>
                <br />
                {content.when}
                {content.where ? (
                  <>
                    <br />
                    {content.where}
                  </>
                ) : null}
              </Text>

              <Text style={s.muted}>
                {content.referenceLabel}: {content.reference}
              </Text>
              <Text style={s.muted}>{content.attachmentNote}</Text>
            </Section>
          </Section>

          <Section style={s.footer}>
            <Text style={s.muted}>{content.footer}</Text>
            {/* SPEC-shared.md §packages/i18n: every email links to a web version. */}
            <Link href={content.webVersionUrl} style={s.muted}>
              {content.webVersionLabel}
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export interface NotificationContent {
  /** BCP-47, for the `lang` attribute. See `ConfirmationContent`. */
  lang: string;
  heading: string;
  intro: string;
  rows: Array<{ label: string; value: string }>;
  linkLabel: string;
  linkUrl: string;
  footer: string;
}

export function NotificationEmail({
  tokens,
  content,
}: {
  tokens: TokenSet;
  content: NotificationContent;
}) {
  const s = toEmailStyles(tokens);

  return (
    <Html lang={content.lang}>
      <Head />
      <Preview>{content.heading}</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.cell}>
            <Section style={s.card}>
              <Text style={s.heading}>{content.heading}</Text>
              <Text style={s.text}>{content.intro}</Text>

              {content.rows.map((row) => (
                <Text style={s.text} key={row.label}>
                  <strong>{row.label}:</strong> {row.value}
                </Text>
              ))}

              <Section style={{ paddingTop: '16px' }}>
                <Link href={content.linkUrl} style={s.button}>
                  {content.linkLabel}
                </Link>
              </Section>
            </Section>
          </Section>

          <Section style={s.footer}>
            <Text style={s.muted}>{content.footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function renderConfirmation(tokens: TokenSet, content: ConfirmationContent) {
  return render(<ConfirmationEmail tokens={tokens} content={content} />);
}

export function renderNotification(tokens: TokenSet, content: NotificationContent) {
  return render(<NotificationEmail tokens={tokens} content={content} />);
}
