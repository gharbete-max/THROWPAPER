import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LocaleConfig } from '@tp/i18n';
import { BUILDER_GRAPH, optionsOf, type Conversation } from '@tp/shared/builder';
import { emptyDefinition } from '@tp/shared/forms';
import { messages } from '../../../lib/messages/all.js';
import { choose, startConversation, type Locales } from './conversation.js';
import { Doors } from './Doors.js';
import { Shell } from './Shell.js';

/**
 * The conversation's screens, rendered — `CAVEATS.md` #37's static half and the component tests
 * S4 names. There is no DOM in this workspace, so each is a static render of a real conversation
 * at a real node; the keys, the motion and the 360 × 640 fit are pressed in the browser
 * (`e2e/guided-builder.spec.ts`).
 */

vi.mock('../../../lib/i18n.js', async () => {
  const { createTranslator } = await import('@tp/i18n');
  const { messages: all } = await import('../../../lib/messages/all.js');
  const t = createTranslator({ supported: ['en-GB'], default: 'en-GB' }, all, 'en-GB');
  return { useT: () => t };
});

const G = BUILDER_GRAPH;
const locales: Locales = { interfaceLocale: 'en-GB', contentLocale: 'en-GB' };
const organisation: LocaleConfig = { supported: ['en-GB'], default: 'en-GB' };
const en = (key: string) => messages[key]!['en-GB']!;

const first = startConversation({
  graph: G,
  definition: emptyDefinition,
  title: {},
  stored: null,
  brandKitExists: false,
}).conversation;

function walk(...answers: (string | number)[]): Conversation {
  return answers.reduce<Conversation>((c, given) => {
    const node = G.nodes.find((n) => n.id === c.state.cursor)!;
    const result = choose(
      G,
      c,
      typeof given === 'number'
        ? { kind: 'quantity', value: given }
        : node.kind === 'text-entry'
          ? { kind: 'text', value: given }
          : node.kind === 'preview-moment'
            ? { kind: 'continue' }
            : { kind: 'option', optionId: given },
      locales,
    );
    if (result.kind !== 'stepped') throw new Error(`refused at ${c.state.cursor}`);
    return result.conversation;
  }, first);
}

const render = (conversation: Conversation) =>
  renderToStaticMarkup(
    <Shell
      graph={G}
      conversation={conversation}
      onChange={() => {}}
      locales={locales}
      contentLocales={organisation}
      desktop={false}
      onOpenEditor={() => {}}
    />,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** The buttons chain up to the question named. */
const untilCount = () => walk('signup', 'later', 'Which day?', 'yes', 'yes', 'one');

describe('a question', () => {
  const html = render(first);

  it('is one sentence at the top, with its answers numbered for the keys', () => {
    expect(html).toContain(
      `<h1 id="conversation-question" class="conversation__question">${en('guided.flow.start.ask')}</h1>`,
    );
    const options = optionsOf(G.nodes[0]!);
    expect(count(html, 'data-answer="')).toBe(options.length);
    for (const option of options) expect(html).toContain(en(option.label));
    expect(html).toMatch(/class="conversation__key" aria-hidden="true">1</);
  });

  it('offers "Or type it", Back, the way out and "Build it myself" — and nothing to go back to yet', () => {
    expect(html).toContain('Or type it — e.g. “four buttons in a row”');
    expect(html).toMatch(/<button type="button" class="button button--quiet" disabled="">/);
    expect(html).toContain(en('conversation.wayOut'));
    expect(html).toContain(en('wizard.advanced'));
    expect(html).not.toContain('conversation__trail');
  });
});

describe('the trail', () => {
  it('says each answer, and greys what was passed over with its reason', () => {
    const html = render(walk('signup'));
    expect(html).toContain(`aria-label="${en('conversation.trail')}"`);
    expect(html).toContain(en('guided.flow.start.signup'));
    expect(html).toContain(`class="conversation__skipped">${en('guided.skip.nothingToGuess')}<`);
    // Something to go back to now.
    expect(html).not.toMatch(/button--quiet" disabled="">/);
  });
});

describe('each kind of node', () => {
  it('a text answer: its own box and example chips, not "Or type it"', () => {
    const at = walk('signup', 'later');
    expect(at.state.cursor).toBe('text.label');
    const html = render(at);
    expect(html).toContain('aria-labelledby="conversation-question"');
    const node = G.nodes.find((n) => n.id === 'text.label')!;
    if (node.kind !== 'text-entry') throw new Error('text.label is a text entry');
    for (const example of node.examples) expect(html).toContain(en(example));
    expect(html).not.toContain('conversation__type');
  });

  it('a number: large, with fewer and more beside it, and typing allowed', () => {
    const at = untilCount();
    expect(at.state.cursor).toBe('choice.count');
    const html = render(at);
    const node = G.nodes.find((n) => n.id === 'choice.count')!;
    if (node.kind !== 'quantity') throw new Error('choice.count is a quantity');
    expect(html).toContain(
      `<output class="conversation__number" aria-live="polite">${node.default}</output>`,
    );
    expect(html).toContain(`aria-label="${en('conversation.fewer')}"`);
    expect(html).toContain(`aria-label="${en('conversation.more')}"`);
    expect(html).toContain('conversation__type');
  });

  it('the live preview: after the shape, and at the preview moment — not before', () => {
    expect(render(walk('signup', 'later', 'Which day?', 'yes', 'yes', 'one', 4))).not.toContain(
      'conversation__preview',
    );
    const placement = walk('signup', 'later', 'Which day?', 'yes', 'yes', 'one', 4, 'pill');
    expect(placement.state.cursor).toBe('choice.placement');
    const html = render(placement);
    expect(html).toContain('conversation__preview');
    // The real control, with the question the person typed.
    expect(html).toContain('Which day?');
  });

  it('the end: open it in the editor, or keep going', () => {
    const at = walk('signup', 'later', 'Which day?', 'yes', 'no', 'no');
    expect(G.nodes.find((n) => n.id === at.state.cursor)?.kind).toBe('end');
    const html = render(at);
    expect(html).toContain(en('wizard.open'));
    expect(html).toContain(en('conversation.keepGoing'));
    expect(html).not.toContain('conversation__type');
  });
});

describe('the doors', () => {
  it('are two large cards, with "Build it myself" beneath', () => {
    const html = renderToStaticMarkup(
      <Doors
        onQuestions={() => {}}
        onPaper={() => {}}
        onMyself={() => {}}
        busy={false}
        error={null}
      />,
    );
    expect(count(html, 'doors__door')).toBe(2);
    expect(html).toContain(en('conversation.doors.questions'));
    expect(html).toContain(en('conversation.doors.paper'));
    expect(html).toContain(en('wizard.advanced'));
  });
});
