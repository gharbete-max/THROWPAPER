import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LocaleConfig } from '@tp/i18n';
import { BUILDER_GRAPH, edit, rebase, type Conversation } from '@tp/shared/builder';
import { emptyDefinition, FORM_TEMPLATES } from '@tp/shared/forms';
import { messages } from '../../../lib/messages/all.js';
import {
  choose,
  crumbs,
  guessName,
  guessReasons,
  startConversation,
  type Locales,
} from './conversation.js';
import { PreviewMoment } from './PreviewMoment.js';
import { Shell } from './Shell.js';

/**
 * The guess on screen — `docs/plan/BELIEF.md` (S11): "This looks like a proxy form. Right?", why,
 * and what "Right" added, each question of it editable in place. Static renders of a real
 * conversation; `e2e/guided-builder.spec.ts` presses it.
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

/** The catalogue, as `GuidedBuilder` has it from the API. */
const templates = FORM_TEMPLATES;

const step = (c: Conversation, given: Parameters<typeof choose>[2]): Conversation => {
  const result = choose(G, c, given, locales, null, templates);
  if (result.kind !== 'stepped') throw new Error(`refused at ${c.state.cursor}`);
  return result.conversation;
};

/** What somebody collecting proxies for an association's meeting says, asked in the engine's order. */
const PROXY: Record<string, string> = {
  'guess.reply': 'no',
  'guess.signature': 'yes',
  'guess.behalf': 'yes',
  'guess.date': 'yes',
  'guess.meeting': 'yes',
};

function toGuess(): Conversation {
  let c = startConversation({
    graph: G,
    definition: emptyDefinition,
    title: {},
    stored: null,
    brandKitExists: false,
    canChangeBrand: false,
  }).conversation;
  c = step(c, { kind: 'option', optionId: 'collect' });
  while (c.state.cursor.startsWith('guess.') && c.state.cursor !== 'guess.confirm') {
    c = step(c, { kind: 'option', optionId: PROXY[c.state.cursor] ?? 'unsure' });
  }
  return c;
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
      brand={{ customised: true, logo: null, organisationName: 'Demo AB' }}
      templates={templates}
    />,
  );

describe('the guess', () => {
  const atGuess = toGuess();

  it('is reached once one recipe is sure enough, and names it in the screen’s language', () => {
    expect(atGuess.state.cursor).toBe('guess.confirm');
    expect(atGuess.state.guess).toMatchObject({ templateId: 'meeting-proxy' });
    // Named by the recipe itself: the same whether or not the catalogue could be loaded.
    expect(guessName(atGuess, 'en-GB')).toBe('Proxy form');
    expect(guessName(atGuess, 'sv-SE')).toBe('Fullmakt');
    const html = render(atGuess);
    expect(html).toContain(
      en('guided.guess.ask').replace('{template}', 'Proxy form').replace(/'/g, '&#x27;'),
    );
    for (const verdict of ['guided.guess.right', 'guided.guess.sortOf', 'guided.guess.no']) {
      expect(html).toContain(en(verdict));
    }
  });

  it('says why: the three answers that moved it most, in the trail’s words', () => {
    const reasons = guessReasons(G, atGuess);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toEqual({
      question: 'guided.guess.behalf.ask',
      answer: 'guided.common.yes',
    });
    const html = render(atGuess);
    expect(html).toContain(en('conversation.guess.why'));
    expect(html).toContain(
      en('conversation.guess.whyLine')
        .replace('{question}', en('guided.guess.behalf.ask'))
        .replace('{answer}', en('guided.common.yes'))
        .replace(/'/g, '&#x27;'),
    );
  });

  it('"Right" without the catalogue is refused as not found, which the screen says', () => {
    const result = choose(
      G,
      atGuess,
      { kind: 'guess', verdict: 'right', templateId: 'meeting-proxy' },
      locales,
      null,
      [],
    );
    expect(result).toEqual({ kind: 'refused', code: 'not-found' });
    expect(en('conversation.guess.unavailable')).toMatch(/could not be loaded/);
  });

  it('says the same after a trip to the editor, which begins a new log', () => {
    const outside = edit(
      atGuess,
      [{ op: 'set', path: 'draft.title', value: { 'en-GB': 'Proxy' } }],
      {
        locale: 'en-GB',
      },
    );
    const rebased = rebase(G, atGuess, outside.state.draft);
    expect(rebased.log).toEqual([]);
    expect(guessReasons(G, rebased)).toEqual(guessReasons(G, atGuess));
  });

  it('No goes on without it, to the next guess when one is sure enough, and the trail says what was said', () => {
    const c = step(atGuess, { kind: 'guess', verdict: 'no', templateId: 'meeting-proxy' });
    expect(c.state.guess?.templateId).toBe('power-of-attorney');
    expect(c.state.cursor).toBe('guess.confirm');
    expect(crumbs(G, c).at(-1)?.said).toEqual([{ key: 'guided.guess.no' }]);
    const html = render(c);
    expect(html).toContain(
      en('guided.guess.ask').replace('{template}', 'Power of attorney').replace(/'/g, '&#x27;'),
    );
    expect(html).not.toContain('Proxy form');
  });
});

describe('what "Right" added', () => {
  const seeded = step(toGuess(), { kind: 'guess', verdict: 'right', templateId: 'meeting-proxy' });

  it('is shown whole, as the form will look, before the conversation goes on', () => {
    expect(seeded.state.cursor).toBe('guess.seeded');
    const html = render(seeded);
    expect(html).toContain(en('guided.preview.ask').replace(/'/g, '&#x27;'));
    // The template's own words: its questions, and its placeholder for the wording.
    expect(html).toContain('Which meeting');
    expect(html).toContain('[Replace this block with your own authorisation wording.');
  });

  it('offers each of its questions to change in place', () => {
    const html = renderToStaticMarkup(
      <PreviewMoment
        spec="form.whole"
        graph={G}
        conversation={seeded}
        contentLocales={organisation}
        contentLocale="en-GB"
        brand={{ customised: true, logo: null, organisationName: 'Demo AB' }}
        editing
        onEditing={() => {}}
        onEdit={() => {}}
        onUseGuided={() => {}}
        onBackTo={() => {}}
      />,
    );
    expect(html).toContain(en('conversation.preview.pick'));
    expect(html).toContain('>Which meeting</button>');
  });
});
