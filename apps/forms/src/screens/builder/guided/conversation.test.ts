import { describe, expect, it } from 'vitest';
import {
  BUILDER_GRAPH,
  changedByHand,
  optionsOf,
  toSession,
  type Conversation,
} from '@tp/shared/builder';
import { emptyDefinition, type FormDefinition } from '@tp/shared/forms';
import { BUILTIN_ALIASES } from '@tp/shared/interpret';
import { THEME_PRESET_IDS } from '@tp/tokens';
import {
  askMenu,
  backTo,
  choiceAt,
  choose,
  confirmGuess,
  crumbs,
  focusedField,
  lastChoice,
  presetChosen,
  readsFreeText,
  rememberOffer,
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

/** An administrator's conversation, unless it says otherwise: only they are asked the colours. */
const start = (
  definition: FormDefinition = emptyDefinition,
  stored: unknown = null,
  canChangeBrand = true,
) =>
  startConversation({ graph: G, definition, title, stored, brandKitExists: false, canChangeBrand });

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
    expect(again).toMatchObject({ kind: 'resumed', rebased: false });
    expect(again.conversation.state.cursor).toBe(c.state.cursor);
    expect(again.conversation.log).toHaveLength(1);
  });

  it('carries on over the form as it is, never over it, when the form was changed elsewhere', () => {
    let c = start().conversation;
    c = press(c, 'signup');
    const stored = JSON.parse(JSON.stringify(toSession(G, c))) as unknown;
    // The classic editor renamed the question since.
    const edited = structuredClone(c.state.draft.definition);
    Object.assign(edited.fields[0]!, { label: { 'sv-SE': 'Ditt namn' } });
    const again = start(edited, stored);
    expect(again).toMatchObject({ kind: 'resumed', rebased: true });
    // The editor's version is the draft; the conversation is where it was; the rename shows as
    // changed by hand, so nothing the conversation does next will write over it.
    expect(again.conversation.state.draft.definition).toEqual(edited);
    expect(again.conversation.state.cursor).toBe(c.state.cursor);
    expect(changedByHand(again.conversation.state, edited.fields[0]!.id)).toBe(true);
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
    let c = press(start().conversation, 'signup');
    // The guess asks what tells it most (S11); two "Not sure" and it asks no more.
    expect(c.state.cursor).toBe('guess.date');
    c = press(press(c, 'unsure'), 'unsure');
    expect(c.state.cursor).toBe('brand.start');
    const [first, , last] = crumbs(G, c);
    expect(first).toMatchObject({
      step: 0,
      question: 'guided.flow.start.ask',
      said: [{ key: 'guided.flow.start.signup' }],
      skipped: [],
    });
    expect(last).toMatchObject({
      question: 'guided.guess.learn.ask',
      said: [{ key: 'guided.common.unsure' }],
      skipped: [{ question: 'guided.guess.ask', reason: 'guided.skip.nothingToGuess' }],
    });
  });

  it('writes typed text in the form’s language, whatever language the screen is in', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'unsure');
    c = press(c, 'unsure');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    expect(focusedField(c)).toMatchObject({ label: { 'sv-SE': 'Vilken dag?' } });
    expect(crumbs(G, c).at(-1)?.said).toEqual([{ text: 'Vilken dag?' }]);
  });

  it('is refused, with nothing changed, when the machine refuses it', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'unsure');
    c = press(c, 'unsure');
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
    c = press(c, 'unsure');
    c = press(c, 'unsure');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    c = press(c, 'yes');
    c = press(c, 'yes');
    return press(c, 'one');
  };

  it('is read in the screen’s language, and the step keeps its tier', () => {
    const result = typed(G, atCount(), 'four please', locales);
    expect(result).toMatchObject({ kind: 'stepped', readings: [{ value: 4, tier: 'T4' }] });
    const c = stepped(result);
    expect(c.log.at(-1)).toMatchObject({ answer: { kind: 'quantity', value: 4 }, tier: 'T4' });
    expect(focusedField(c)).toMatchObject({ options: { length: 4 } });
  });

  it('asks, and changes nothing, below every threshold', () => {
    const c = atCount();
    expect(typed(G, c, 'some', locales)).toMatchObject({ kind: 'ask', reason: 'vague' });
    expect(typed(G, c, 'banana', locales)).toMatchObject({ kind: 'ask', reason: 'nothing' });
  });

  /** At "Do you want buttons?", about "Vilken dag?". */
  const atButtons = () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'unsure');
    c = press(c, 'unsure');
    c = press(c, 'later');
    c = stepped(choose(G, c, { kind: 'text', value: 'Vilken dag?' }, locales));
    return press(c, 'yes');
  };

  it('that says several things answers each, a step apiece, and stays where it was not answered', () => {
    const before = atButtons();
    const result = typed(G, before, 'three buttons, pill shape, side by side', locales);
    expect(result).toMatchObject({ kind: 'stepped', unused: [] });
    const c = stepped(result);
    expect(c.log.slice(before.log.length).map((e) => [e.nodeId, e.tier])).toEqual([
      ['choice.buttons', 'T5'],
      ['choice.count', 'T5'],
      ['choice.shape', 'T5'],
      ['choice.placement', 'T5'],
    ]);
    expect(c.state.cursor).toBe('choice.answers');
    expect(focusedField(c)).toMatchObject({
      options: { length: 3 },
      style: { shape: 'pill', columns: 'auto' },
    });
  });

  it('says what it could not use: words it did not read, and answers the conversation cannot take', () => {
    const result = typed(G, atButtons(), 'no buttons, pills', locales);
    // "No buttons" moves on; there is no shape to give buttons nobody wants.
    expect(result).toMatchObject({
      kind: 'stepped',
      readings: [{ nodeId: 'choice.buttons', optionId: 'no' }],
      unused: [{ text: 'pills', why: 'not-now' }],
    });
    expect(stepped(result).state.cursor).toBe('flow.more');
  });

  it('that is a list is the options, labels verbatim, in one step', () => {
    const c = stepped(typed(G, atCount(), 'Röd, Grön, Blå', locales));
    expect(c.log.at(-1)).toMatchObject({
      answer: { kind: 'list', labels: ['Röd', 'Grön', 'Blå'] },
      tier: 'T6',
    });
    expect(focusedField(c)).toMatchObject({
      options: [
        { label: { 'sv-SE': 'Röd' } },
        { label: { 'sv-SE': 'Grön' } },
        { label: { 'sv-SE': 'Blå' } },
      ],
    });
  });

  it('about another question is a guess, and nothing happens until it is confirmed', () => {
    let c = press(atButtons(), 'yes');
    expect(c.state.cursor).toBe('choice.answers');
    const guess = typed(G, c, 'pills', locales);
    expect(guess).toMatchObject({
      kind: 'guess',
      reading: { nodeId: 'choice.shape', optionId: 'pill', tier: 'T7' },
    });
    if (guess.kind !== 'guess') return;
    c = stepped(confirmGuess(G, c, 'pills', guess.reading, locales));
    // Answered ahead of its turn: the conversation still asks "One answer or several?".
    expect(c.state.cursor).toBe('choice.answers');
    expect(c.log.at(-1)).toMatchObject({ nodeId: 'choice.shape', tier: 'T7' });
  });

  it('that could be about another question offers that question beside the menu', () => {
    const result = typed(G, atCount(), 'pill, square', locales);
    expect(result).toMatchObject({
      kind: 'ask',
      reason: 'nothing',
      elsewhere: [{ nodeId: 'choice.shape', question: 'guided.choice.shape.ask' }],
    });
  });

  it('that was not read, then picked from the menu, may be remembered — when that could work', () => {
    const [pill] = askMenu(G, 'choice.shape');
    expect(pill).toMatchObject({ nodeId: 'choice.shape', optionId: 'pill', tier: 'T8' });
    expect(rememberOffer(G, '  blobby ', pill!, locales, BUILTIN_ALIASES)).toEqual({
      phrase: 'blobby',
      nodeId: 'choice.shape',
      optionId: 'pill',
      locale: 'en',
    });
    // Already a way of saying something else: offering would only end in a refusal.
    expect(rememberOffer(G, 'square', pill!, locales, BUILTIN_ALIASES)).toBeNull();
    expect(rememberOffer(G, '   ', pill!, locales, BUILTIN_ALIASES)).toBeNull();
    expect(
      rememberOffer(G, 'lots', { ...pill!, optionId: null, value: 4 }, locales, BUILTIN_ALIASES),
    ).toBeNull();
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
    c = press(c, 'unsure');
    c = press(c, 'unsure');
    c = press(c, 'later');
    const [, , , brand] = crumbs(G, c);
    const back = backTo(c, brand!.step);
    expect(back.state.cursor).toBe('brand.start');
    expect(back.log).toHaveLength(3);
    // Focus goes back to the answer given there.
    expect(choiceAt(c, brand!.step)).toBe('later');
  });
});

describe('the live preview', () => {
  it('shows once the shape is answered, and again at the end — not before', () => {
    let c = press(start().conversation, 'signup');
    c = press(c, 'unsure');
    c = press(c, 'unsure');
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
    const c = press(press(press(start().conversation, 'signup'), 'unsure'), 'unsure');
    expect(c.state.cursor).toBe('brand.start');
    const out = wayOut(G, c).map((o) => o.nodeId);
    expect(out).toEqual(['brand.quick', 'brand.logoSlot', 'brand.preview']);
    expect(wayOut(G, start().conversation).map((o) => o.nodeId)).toEqual(['menu.top']);
  });
});

describe('the colours (owner question 8)', () => {
  /** "Should this look like your organisation?" — yes, with no brand kit yet. */
  const toColours = (canChangeBrand: boolean) => {
    let c = press(start(emptyDefinition, null, canChangeBrand).conversation, 'signup');
    c = press(press(c, 'unsure'), 'unsure'); // past the guess (S11)
    return press(c, 'yes');
  };

  it('are asked of an administrator', () => {
    expect(toColours(true).state.cursor).toBe('brand.quick');
  });

  it('are passed by for anyone else, and the trail says why', () => {
    const c = toColours(false);
    expect(c.state.cursor).toBe('brand.logoSlot');
    expect(crumbs(G, c).at(-1)?.skipped).toEqual([
      { question: 'guided.brand.quick.ask', reason: 'guided.skip.brandByAdministrator' },
    ]);
  });

  it('offer only presets a brand kit can take, never Loppa’s own look (CAVEATS.md #32)', () => {
    const node = G.nodes.find((n) => n.id === 'brand.quick')!;
    const written = optionsOf(node).flatMap((option) =>
      option.patch.flatMap((op) =>
        op.op === 'set' && op.path === 'pending.themePreset' ? [op.value] : [],
      ),
    );
    expect(written).toHaveLength(optionsOf(node).length);
    for (const preset of written) {
      expect(THEME_PRESET_IDS).toContain(preset);
      expect(preset).not.toBe('default');
    }
  });

  it('a step that chose one is known by what it changed: pressed or typed alike', () => {
    const at = toColours(true);
    expect(presetChosen(at, press(at, 'garden'))).toBe('garden');
    expect(presetChosen(at, stepped(typed(G, at, 'Garden', locales)))).toBe('garden');
  });

  it('nothing else is a colour choice: another answer, a jump, or Back', () => {
    const at = toColours(true);
    const garden = press(at, 'garden');
    expect(presetChosen(at, press(at, 'midnight'))).toBe('midnight');
    expect(presetChosen(garden, press(garden, 'header-left'))).toBeNull();
    expect(
      presetChosen(at, stepped(choose(G, at, { kind: 'jump', to: 'brand.logoSlot' }, locales))),
    ).toBeNull();
    expect(presetChosen(garden, stepBack(garden))).toBeNull();
  });

  it('choosing the preset already chosen is held again', () => {
    const garden = press(toColours(true), 'garden');
    const again = stepped(choose(G, garden, { kind: 'jump', to: 'brand.quick' }, locales));
    expect(again.state.cursor).toBe('brand.quick');
    expect(presetChosen(again, press(again, 'garden'))).toBe('garden');
  });

  it('resumes with today’s facts: a role changed since decides what is asked from now on', () => {
    const asAdmin = press(press(press(start().conversation, 'signup'), 'unsure'), 'unsure');
    const stored = JSON.parse(JSON.stringify(toSession(G, asAdmin))) as unknown;
    const again = start(asAdmin.state.draft.definition, stored, false);
    expect(again).toMatchObject({ kind: 'resumed', rebased: false });
    expect(again.conversation.log).toEqual(asAdmin.log);
    expect(again.conversation.state.pending).toMatchObject({ canChangeBrand: false });
    expect(press(again.conversation, 'yes').state.cursor).toBe('brand.logoSlot');
  });
});
