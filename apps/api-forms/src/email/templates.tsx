import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components';
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
