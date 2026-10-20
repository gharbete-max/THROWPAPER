import { describe, expect, it } from 'vitest';
import {
  SEND_LIMITS,
  SendCampaignRequest,
  checkCampaign,
  mergeCampaign,
  renderCampaign,
  uniqueRecipients,
  type BatchRow,
} from './index.js';

const row = (patch: Partial<BatchRow> = {}): BatchRow => ({
  name: 'Åsa Ek',
  email: 'asa@example.com',
  amount: '',
  reference: '',
  ...patch,
});

// Stand-ins for the sender's own words: the product writes none of them.
const FOOTER = 'Sender, address. Stop: {{unsubscribe}}';

describe('merge fields and fallbacks', () => {
  it('fills a field, and takes the fallback only when the list has nothing', () => {
    expect(mergeCampaign('Hi {{name | there}}', row())).toBe('Hi Åsa Ek');
    expect(mergeCampaign('Hi {{name | there}}', row({ name: '  ' }))).toBe('Hi there');
    expect(mergeCampaign('Hi {{ name|friend }}!', row({ name: '' }))).toBe('Hi friend!');
    expect(mergeCampaign('Hi {{name}}!', row({ name: '' }))).toBe('Hi !');
  });

  it('leaves what is not a field as written, and fills the link only when given one', () => {
    expect(mergeCampaign('{{nope}} {{unsubscribe}}', row())).toBe('{{nope}} {{unsubscribe}}');
    expect(mergeCampaign('{{unsubscribe}}', row(), 'https://x.test/u/1')).toBe(
      'https://x.test/u/1',
    );
  });

  it('does not read $ patterns in a value as replacement syntax', () => {
    expect(mergeCampaign('{{name}}', row({ name: "$& $1 $'" }))).toBe("$& $1 $'");
  });

  it('keeps a subject on one line, whatever a cell held', () => {
    const { subject } = renderCampaign(
      { subject: 'Hello {{name}}', body: 'b', footer: FOOTER },
      row({ name: 'Bo\r\nBcc: x@example.com' }),
    );
    expect(subject).not.toMatch(/[\r\n]/);
  });
});

describe('checking a campaign', () => {
  it('passes a complete one', () => {
    expect(checkCampaign('Hi', 'Body {{name | there}}', FOOTER, [row()])).toEqual([]);
  });

  it('refuses a campaign with no footer, or a footer without the unsubscribe link', () => {
    expect(checkCampaign('Hi', 'Body', '   ', [row()])).toContainEqual({
      row: -1,
      field: 'footer',
      code: 'footer-missing',
    });
    expect(checkCampaign('Hi', 'Body', 'Sender, address', [row()])).toContainEqual({
      row: -1,
      field: 'footer',
      code: 'footer-no-link',
    });
    expect(checkCampaign('Hi', 'Body', 'Stop {{ unsubscribe }}', [row()])).toEqual([]);
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('refuses a footer that still has a bracketed placeholder, and names it', () => {
    const skeleton =
      '[Your name] · [Your address]\nBecause [why].\nStop: {{unsubscribe}} [Your name]';
    expect(checkCampaign('Hi', 'Body', skeleton, [row()])).toEqual([
      {
        row: -1,
        field: 'footer',
        code: 'footer-placeholder',
        left: ['[Your name]', '[Your address]', '[why]'],
      },
    ]);
    expect(checkCampaign('Hi', 'Body', 'Ann, Main St 1 (why)\n{{unsubscribe}}', [row()])).toEqual(
      [],
    );
  });

  it('names the rows that leave a field empty where there is no fallback', () => {
    const problems = checkCampaign('Hi', 'Dear {{name}}', FOOTER, [
      row(),
      row({ name: '', email: 'bo@example.com' }),
    ]);
    expect(problems).toEqual([{ row: 1, field: 'name', code: 'empty-field' }]);
    expect(checkCampaign('Hi', 'Dear {{name | there}}', FOOTER, [row({ name: '' })])).toEqual([]);
  });

  it('names bad addresses and unknown fields; the link cannot be in the subject', () => {
    expect(checkCampaign('Hi', 'b', FOOTER, [row({ email: 'nope' })])).toEqual([
      { row: 0, field: 'email', code: 'bad-email' },
    ]);
    expect(checkCampaign('{{nope}}', 'b', FOOTER, [row()])).toContainEqual({
      row: -1,
      field: 'subject',
      code: 'unknown-field',
    });
    expect(checkCampaign('{{unsubscribe}}', 'b', FOOTER, [row()])).toContainEqual({
      row: -1,
      field: 'subject',
      code: 'unknown-field',
    });
  });

  it('holds the hard cap: one over is refused, not trimmed', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row({ email: `p${i}@example.com` }));
    expect(checkCampaign('Hi', 'b', FOOTER, rows(SEND_LIMITS.campaign))).toEqual([]);
    expect(checkCampaign('Hi', 'b', FOOTER, rows(SEND_LIMITS.campaign + 1))).toContainEqual({
      row: -1,
      field: 'email',
      code: 'too-many',
    });
  });
});

describe('the audience', () => {
  it('is each address once, by its lower-case form, in list order', () => {
    const rows = [
      row({ email: 'Asa@Example.com' }),
      row({ email: 'bo@example.com', name: 'Bo' }),
      row({ email: ' asa@example.com ' }),
      row({ email: 'broken' }),
    ];
    expect(uniqueRecipients(rows).map((r) => r.name)).toEqual(['Åsa Ek', 'Bo']);
  });
});

describe('a campaign is plain text with nothing to track', () => {
  it('has no html, no image and no rewritten link in what it renders', () => {
    const body = 'Read it at https://example.org/page?utm=1 today.';
    const { text } = renderCampaign(
      { subject: 's', body, footer: FOOTER },
      row(),
      'https://app.test/u/t',
    );
    expect(text).toContain('https://example.org/page?utm=1');
    expect(text).toContain('https://app.test/u/t');
    expect(text).not.toMatch(/<[a-z]/i);
    // The only addresses in it are the sender's own and the unsubscribe link.
    expect((text.match(/https?:\/\/[^\s]+/g) ?? []).sort()).toEqual([
      'https://app.test/u/t',
      'https://example.org/page?utm=1',
    ]);
  });

  it('is refused without the confirmation', () => {
    const base = {
      key: crypto.randomUUID(),
      subject: 's',
      body: 'b',
      footer: FOOTER,
      rows: [row()],
    };
    expect(SendCampaignRequest.safeParse(base).success).toBe(false);
    expect(SendCampaignRequest.safeParse({ ...base, confirmed: true }).success).toBe(true);
  });
});
