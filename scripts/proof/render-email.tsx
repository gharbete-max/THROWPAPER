import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';
import { toEmailStyles, type TokenSet } from '@tp/tokens';
import { proofCard, NORDIC_PROBE, type ProofCard } from './card.js';

/**
 * Email target: the same card, built from resolved inline styles and table layout. Nothing here
 * reads a CSS variable — the compiled styles are literal values by construction.
 */
export function ProofEmail({ tokens, card }: { tokens: TokenSet; card: ProofCard }) {
  const s = toEmailStyles(tokens);

  return (
    <Html lang="sv">
      <Head />
      <Preview>{card.eyebrow}</Preview>
      <Body style={s.body}>
        <Container style={s.container}>
          <Section style={s.cell}>
            <Section style={s.card}>
              <Text style={s.muted}>{card.eyebrow}</Text>
              <Text style={s.heading}>{card.title}</Text>
              <Text style={s.text}>{card.body}</Text>
              <Text style={s.muted}>{card.meta}</Text>
              <Section style={{ paddingTop: '16px' }}>
                <Link href={card.buttonHref} style={s.button}>
                  {card.buttonLabel}
                </Link>
              </Section>
            </Section>
          </Section>
          <Section style={s.footer}>
            <Text style={s.muted}>
              {card.footer} · {NORDIC_PROBE}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function renderEmail(tokens: TokenSet, card: ProofCard = proofCard): Promise<string> {
  return render(<ProofEmail tokens={tokens} card={card} />);
}
