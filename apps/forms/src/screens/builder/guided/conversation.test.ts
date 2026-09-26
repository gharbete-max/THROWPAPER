import { describe, expect, it } from 'vitest';
import { BUILDER_GRAPH, toSession, type Conversation } from '@tp/shared/builder';
import { emptyDefinition, type FormDefinition } from '@tp/shared/forms';
import {
  backTo,
  choiceAt,
  choose,
  crumbs,
  focusedField,
  lastChoice,
  readsFreeText,
  showsPreview,
  startConversation,
  stepBack,
  typed,
  wayOut,
  type Locales,
} from './conversation.js';

/**
 * The guided screen's logic without a screen: how a conversation starts or resumes, how a press
 * or a typed answer becomes a step, and what the trail and the way out offer.
 */

const G = BUILDER_GRAPH;
const locales: Locales = { interfaceLocale: 'en-GB', contentLocale: 'sv-SE' };
const title = { 'sv-SE': 'Mat' };

const start = (definition: FormDefinition = emptyDefinition, stored: unknown = null) =>
  startConversation({ graph: G, definition, title, stored, brandKitExists: false });

function stepped(result: ReturnType<typeof choose> | ReturnType<typeof typed>): Conversation {
  if (result.kind !== 'stepped') throw new Error(`not a step: ${JSON.stringify(result)}`);
  return result.conversation;
}

const press = (c: Conversation, optionId: string) =>
  stepped(choose(G, c, { kind: 'option', optionId }, locales));

describe('starting', () => {
  it('begins a new conversation at the first question', () => {
    const started = start();
    expect(started).toMatchObject({ kind: 'fresh', discarded: null });
    expect(started.conversation.state.cursor).toBe('flow.start');
  });

  it('resumes a saved one that still describes the form, at the same question', () => {
    let c = start().conversation;
    c = press(c, 'signup');
    const stored = JSON.parse(JSON.stringify(toSession(G, c))) as unknown;
    const again = start(c.state.draft.definition, stored);
    expect(again.kind).toBe('resumed');
    expect(again.conversation.state.cursor).toBe(c.state.cursor);
    expect(again.conversation.log).toHaveLength(1);
  });

  it('starts again from the form, never over it, when the form was changed elsewhere', () => {
    let c = start().conversation;
    c = press(c, 'signup');
    const stored = JSON.parse(JSON.stringify(toSession(G, c))) as unknown;
    // The classic editor renamed the question since.
    const edited = structuredClone(c.state.draft.definition);
    Object.assign(edited.fields[0]!, { label: { 'sv-SE': 'Ditt namn' } });
    const again = start(edited, stored);
    expect(again).toMatchObject({ kind: 'fresh', discarded: 'changed-elsewhere' });
    expect(again.conversation.state.draft.definition).toEqual(edited);
  });

  it('starts again when the saved one cannot be read', () => {
    expect(start(emptyDefinition, { nonsense: true })).toMatchObject({
      kind: 'fresh',
      discarded: 'unreadable',
    });
  });
});

describe('a step', () => {
  it('is a press, with the passed-over questions in the trail', () => {
    const c = press(start().conversation, 'signup');
    expect(c.state.cursor).toBe('brand.start');
    const [crumb] = crumbs(G, c);
    expect(crumb).toMatchObject({
      step: 0,
      question: 'guided.flow.start.ask',
      said: [{ key: 'guided.flow.start.signup' }],
      skipped: [{ question: 'guided.guess.ask', reason: 'guided.skip.nothingToGuess' }],
    });
  });

  it('writes typed text in the form’s language, whatever language the screen is in', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    expect(focusedField(c)).toMatchObject({ label: { 'sv-SE': 'Vilken dag?' } });
    expect(crumbs(G, c).at(-1)?.said).toEqual([{ text: 'Vilken dag?' }]);
  });

  it('is refused, with nothing changed, when the machine refuses it', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    c = press(c, 'yes'); // required
    c = press(c, 'yes'); // buttons
    c = press(c, 'one');
    expect(c.state.cursor).toBe('choice.count');
    expect(choose(G, c, { kind: 'quantity', value: 40 }, locales)).toEqual({
      kind: 'refused',
      code: 'out-of-range',
    });
  });
});

describe('typing an answer', () => {
  const atCount = () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    c = press(c, 'yes');
    c = press(c, 'yes');
    return press(c, 'one');
  };

  it('is read in the screen’s language, and the step keeps its tier', () => {
    const result = typed(G, atCount(), 'four please', locales);
    expect(result).toMatchObject({ kind: 'stepped', reading: { value: 4, tier: 'T4' } });
    const c = stepped(result);
    expect(c.log.at(-1)).toMatchObject({ answer: { kind: 'quantity', value: 4 }, tier: 'T4' });
    expect(focusedField(c)).toMatchObject({ options: { length: 4 } });
  });

  it('asks, and changes nothing, below every threshold', () => {
    const c = atCount();
    expect(typed(G, c, 'some', locales)).toMatchObject({ kind: 'ask', reason: 'vague' });
    expect(typed(G, c, 'banana', locales)).toMatchObject({ kind: 'ask', reason: 'nothing' });
  });

  it('is offered only where free text chooses an answer', () => {
    const kinds = Object.fromEntries(G.nodes.map((n) => [n.kind, readsFreeText(n)]));
    expect(kinds).toEqual({
      question: true,
      'pick-one': true,
      quantity: true,
      'text-entry': false,
      'confirm-guess': false,
      'preview-moment': false,
      menu: false,
      end: false,
    });
  });
});

describe('going back', () => {
  it('undoes one step, and at the start there is nothing to undo', () => {
    const first = start().conversation;
    expect(stepBack(first)).toBe(first);
    const c = press(first, 'signup');
    expect(lastChoice(c)).toBe('signup');
    expect(stepBack(c).state).toEqual(first.state);
  });

  it('returns to any crumb’s question, to answer it again', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'later');
    const [, second] = crumbs(G, c);
    const back = backTo(c, second!.step);
    expect(back.state.cursor).toBe('brand.start');
    expect(back.log).toHaveLength(1);
    // Focus goes back to the answer given there.
    expect(choiceAt(c, second!.step)).toBe('later');
  });
});

describe('the live preview', () => {
  it('shows once the shape is answered, and again at the end — not before', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    for (const id of ['yes', 'yes', 'one']) c = press(c, id);
    c = stepped(choose(G, c, { kind: 'quantity', value: 4 }, locales));
    expect(c.state.cursor).toBe('choice.shape');
    expect(showsPreview(G, c)).toBe(false);
    c = press(c, 'pill');
    expect(c.state.cursor).toBe('choice.placement');
    expect(showsPreview(G, c)).toBe(true);
    c = press(c, 'under-full');
    expect(c.state.cursor).toBe('choice.preview');
    expect(showsPreview(G, c)).toBe(true);
    c = stepped(choose(G, c, { kind: 'continue' }, locales));
    expect(showsPreview(G, c)).toBe(false);
  });
});

describe('the way out', () => {
  it('offers the group’s other questions, or the menu, and never where you are', () => {
    const c = press(start().conversation, 'signup');
    expect(c.state.cursor).toBe('brand.start');
    const out = wayOut(G, c).map((o) => o.nodeId);
    expect(out).toEqual(['brand.quick', 'brand.logoSlot', 'brand.preview']);
    expect(wayOut(G, start().conversation).map((o) => o.nodeId)).toEqual(['menu.top']);
  });
});
