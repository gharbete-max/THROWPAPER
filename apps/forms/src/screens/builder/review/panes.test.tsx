import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LocaleConfig } from '@tp/i18n';
import { messages } from '../../../lib/messages/all.js';
import { readDocument } from '../paper/pipeline.js';
import { DraftPane, kindName } from './DraftPane.js';
import { act, startReview, type Review } from './review.js';
import { SourcePane } from './SourcePane.js';

/**
 * The review screen's two panes, rendered — the static half; the presses, the keys and the PDF page
 * are in `e2e/review.spec.ts`. There is no DOM in this workspace, so each is a static render of a
 * real review.
 */

vi.mock('../../../lib/i18n.js', async () => {
  const { createTranslator } = await import('@tp/i18n');
  const { messages: all } = await import('../../../lib/messages/all.js');
  const t = createTranslator({ supported: ['en-GB'], default: 'en-GB' }, all, 'en-GB');
  return { useT: () => t };
});

const en = (key: string) => messages[key]!['en-GB']!;
const locales: LocaleConfig = { supported: ['en-GB'], default: 'en-GB' };
const reading = readDocument({
  kind: 'paste',
  text: 'PERSONUPPGIFTER\n\n1. Question one\n2. Question two\n\nE-post: ____',
});
const start = startReview(reading);

const draft = (review: Review, selectedId: string | null) =>
  renderToStaticMarkup(
    <DraftPane
      review={review}
      debug={reading.debug}
      selectedId={selectedId}
      onSelect={() => {}}
      onAct={() => {}}
      locale="en-GB"
      locales={locales}
    />,
  );

describe('the draft pane', () => {
  it('says what each item is and how sure the reading is', () => {
    const html = draft(start, null);
    expect(html).toContain(en('review.kind.heading'));
    expect(html).toContain(en('review.kind.question'));
    expect(html).toContain(en('review.bucket.auto'));
    expect(html).toContain(en('review.bucket.flag'));
    expect(html).toContain('review-item--flag');
  });

  it('offers a guess its chips, numbered for the keys, and nothing to one it is sure of', () => {
    const html = draft(start, null);
    expect(html).toContain(en('review.guessed'));
    for (const kind of ['short_text', 'long_text', 'number'] as const) {
      expect(html).toContain(en(kindName(kind)));
    }
    // Two guesses, three chips each; none for the heading or the e-mail it is sure of.
    expect(html.split('class="review-chip"').length - 1).toBe(6);
    expect(html).toMatch(/review-chip__key" aria-hidden="true">1</);
  });

  it('shows the actions on the selected item only, and only those that can be done', () => {
    const question = start.items.find((item) => item.text === 'Question one')!;
    const html = draft(start, question.id);
    expect(html).toContain(en('review.accept'));
    expect(html).toContain(en('review.merge'));
    expect(html).toContain(en('review.justText'));
    // One line: nothing to split. A question already: nothing to make one of.
    expect(html).not.toContain(en('review.split'));
    expect(html).not.toContain(en('review.makeQuestion'));
    expect(html).toContain(en('review.why'));
    expect(draft(start, null)).not.toContain(en('review.accept'));
  });

  it('marks a settled item as settled, with its chip pressed', () => {
    const question = start.items.find((item) => item.text === 'Question one')!;
    const picked = act(start, { kind: 'pick', itemId: question.id, type: 'long_text' });
    const html = draft(picked, null);
    expect(html).toContain(en('review.settled'));
    expect(html).toContain('aria-pressed="true"');
  });

  it('names every kind a chip can offer', () => {
    const kinds = [
      'short_text',
      'long_text',
      'number',
      'money',
      'date',
      'time',
      'email',
      'phone',
      'address',
      'personnummer',
      'orgnr',
      'file',
      'signature',
      'yes_no',
      'consent',
      'single_select',
      'multi_select',
      'grid',
      'repeating_group',
    ] as const;
    for (const kind of kinds) expect(messages[kindName(kind)], kind).toBeDefined();
  });
});

describe('the source pane', () => {
  it('shows a paste’s lines, each highlighted by its item’s bucket, the selected one marked', () => {
    const question = start.items.find((item) => item.text === 'Question one')!;
    const html = renderToStaticMarkup(
      <SourcePane
        layout={reading.layout}
        pdf={null}
        items={start.items}
        selectedId={question.id}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain(`aria-label="${en('review.source')}"`);
    expect(html).toContain('review-line--auto');
    expect(html).toContain('review-line--flag');
    expect(html).toMatch(/review-line--flag review-line--selected"[^>]*>1\. Question one</);
    // By keyboard, the items are the way through: the lines are for the pointer.
    expect(html).not.toMatch(/data-line="[^"]+" class="[^"]+"[^>]*tabindex="0"/);
  });
});
