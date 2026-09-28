import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AliasEntry, LearnedAlias } from '@tp/shared/interpret';
import { ImportPreview, listed } from './LearnedPhrases.js';

/**
 * Learned phrases (S6), without a browser: the order an administrator sees them in, and what an
 * import says it would do before it does anything. The page's buttons are pressed in
 * `e2e/guided-builder.spec.ts`.
 */

vi.mock('../../../lib/i18n.js', async () => {
  const { createTranslator } = await import('@tp/i18n');
  const { messages: all } = await import('../../../lib/messages/all.js');
  const t = createTranslator({ supported: ['en-GB'], default: 'en-GB' }, all, 'en-GB');
  return { useT: () => t };
});

const entry = (phrase: string, optionId: string, count = 1): AliasEntry => ({
  phrase,
  nodeId: 'choice.shape',
  optionId,
  locale: 'en',
  source: 'user-confirmed',
  createdAt: '2026-09-28',
  count,
  notes: '',
});
const learned = (phrase: string, optionId: string, count: number, id: string): LearnedAlias => ({
  ...entry(phrase, optionId, count),
  id,
});

describe('learned phrases', () => {
  it('are listed the most remembered first, then in the alias file’s order', () => {
    const rows = listed([
      learned('zebra', 'pill', 1, '00000000-0000-4000-8000-000000000001'),
      learned('Äpple', 'pill', 1, '00000000-0000-4000-8000-000000000002'),
      learned('blobby', 'square', 4, '00000000-0000-4000-8000-000000000003'),
      learned('apple', 'pill', 1, '00000000-0000-4000-8000-000000000004'),
    ]);
    expect(rows.map((r) => r.phrase)).toEqual(['blobby', 'apple', 'zebra', 'Äpple']);
  });

  it('say, before an import, what it would add, what is known, and what is refused and why', () => {
    const html = renderToStaticMarkup(
      <ImportPreview
        preview={{
          file: {},
          diff: {
            added: [entry('shiny', 'square')],
            present: [entry('blobby', 'pill')],
            refused: [{ entry: entry('blobby', 'square'), reason: 'collision', means: 'pill' }],
            stored: false,
          },
        }}
        answer={(_node, option) => (option === 'pill' ? 'Pill' : option)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain('1 to add');
    expect(html).toContain('1 already known');
    expect(html).toContain('1 not added');
    expect(html).toContain('already means “Pill”');
    expect(html).toContain('Add 1 phrase');
  });

  it('cannot be imported when a file adds nothing', () => {
    const html = renderToStaticMarkup(
      <ImportPreview
        preview={{
          file: {},
          diff: { added: [], present: [entry('blobby', 'pill')], refused: [], stored: false },
        }}
        answer={(_node, option) => option}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add 0 phrases<\/button>/);
  });
});
