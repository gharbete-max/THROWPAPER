import { describe, expect, it } from 'vitest';
import { answer, begin, guardStateOf } from '../builder/machine.js';
import { BUILDER_GRAPH } from '../builder/graph/nodes.js';
import { emptyDefinition } from '../forms/definition.js';
import {
  AliasFile,
  BUILTIN_ALIASES,
  aliasImportDiff,
  aliasInert,
  aliasRefusal,
  type AliasEntry,
} from './aliases.js';
import { clausesOf } from './clauses.js';
import { aheadOf, interpret, toAnswer } from './ladder.js';
import { lexiconFor } from './lexicon.js';
import { listOf } from './list.js';

/**
 * The rungs that read a group (S6) — the parts the phrase tables do not isolate: where a sentence
 * is cut, how a list is read, what the conversation's state hides, and the rules for what may be
 * learned. The tables in `fixtures/ladder/` hold the readings themselves.
 */

const G = BUILDER_GRAPH;
const texts = (input: string, language: Parameters<typeof lexiconFor>[0]) =>
  clausesOf(input, lexiconFor(language)).map((c) => input.slice(c.start, c.end));

describe('clauses', () => {
  it('are cut at punctuation and at the language’s conjunctions, trimmed, as spans of the input', () => {
    expect(texts('three buttons, pill shape and side by side!', 'en')).toEqual([
      'three buttons',
      'pill shape',
      'side by side',
    ]);
    expect(texts('flera svar och flikar', 'sv')).toEqual(['flera svar', 'flikar']);
    expect(texts('多选和标签页', 'zh')).toEqual(['多选', '标签页']);
    expect(texts('  ;, ', 'en')).toEqual([]);
  });

  it('never cut a word in two: Japanese と after kana is part of the word', () => {
    // ひとつ is "one"; ボタンと is "buttons and".
    expect(texts('ひとつ', 'ja')).toEqual(['ひとつ']);
    expect(texts('ボタンとタブ', 'ja')).toEqual(['ボタン', 'タブ']);
    expect(texts('Sandwich', 'en')).toEqual(['Sandwich']);
  });
});

describe('a list', () => {
  it('is cut at semicolons when there are any, otherwise at commas, labels verbatim', () => {
    expect(listOf('Röd, Grön ,  Blå')?.labels).toEqual(['Röd', 'Grön', 'Blå']);
    expect(listOf('3,50 kr; 4,50 kr')?.labels).toEqual(['3,50 kr', '4,50 kr']);
    expect(listOf('赤、緑、青')?.labels).toEqual(['赤', '緑', '青']);
    expect(listOf('Just one thing')).toBeNull();
  });

  it('on several lines is read as the importer reads a paste: markers are not labels', () => {
    expect(listOf('1. Röd\n2. Grön\n\n3. Blå')?.labels).toEqual(['Röd', 'Grön', 'Blå']);
    // A line without a marker among the list's is an item as it stands.
    expect(listOf('• Red\n• Green\nBlue')?.labels).toEqual(['Red', 'Green', 'Blue']);
    // One bullet alone is not a sure list, for the detector or here: its marker stays.
    expect(listOf('• Red\nGreen')?.labels).toEqual(['• Red', 'Green']);
    expect(listOf('Mon\n\n\nTue')?.span).toEqual([0, 9]);
  });

  it('is not a set of options when it is nested', () => {
    expect(listOf('1. Frukt\n   a) Äpple\n   b) Päron\n2. Grönsaker')).toBeNull();
  });
});

describe('the group, from a node', () => {
  it('is the node and every node the conversation can go on to within its group', () => {
    expect(aheadOf(G, 'choice.count').map((n) => n.id)).toEqual([
      'choice.count',
      'choice.shape',
      'choice.placement',
      'choice.preview',
    ]);
    // Never back: answering "Do you want buttons?" again from here would change an answer unseen.
    expect(aheadOf(G, 'choice.shape').map((n) => n.id)).not.toContain('choice.buttons');
  });
});

describe('what the conversation’s state hides', () => {
  const locale = 'en-GB';
  /** At "Do you want buttons?", nothing about buttons said yet. */
  const atButtons = () =>
    [
      { kind: 'option', optionId: 'signup' },
      { kind: 'option', optionId: 'unsure' },
      { kind: 'option', optionId: 'unsure' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Which day?' },
      { kind: 'option', optionId: 'yes' },
    ].reduce(
      (c, a) => answer(G, c, a as Parameters<typeof answer>[2], { locale }),
      begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } }),
    );

  it('a guess about a question the conversation could not ask now is not offered', () => {
    const c = atButtons();
    const read = (state?: ReturnType<typeof guardStateOf>) =>
      interpret('several answers', { graph: G, nodeId: 'choice.buttons', locale, state });
    expect(read()).toMatchObject({ outcome: 'guess', reading: { nodeId: 'choice.answers' } });
    // "One answer or several?" is not asked until there are buttons.
    expect(read(guardStateOf(c))).toMatchObject({ outcome: 'ask', reason: 'nothing' });
  });

  it('nor a list for options there are no buttons for yet', () => {
    const c = atButtons();
    const read = (state?: ReturnType<typeof guardStateOf>) =>
      interpret('Red, Green', { graph: G, nodeId: 'choice.buttons', locale, state });
    expect(read()).toMatchObject({ outcome: 'apply', reading: { nodeId: 'choice.count' } });
    expect(read(guardStateOf(c)).outcome).toBe('ask');
  });

  it('a list becomes the answer the machine takes', () => {
    const read = interpret('Red, Green', { graph: G, nodeId: 'choice.count', locale });
    if (read.outcome !== 'apply') throw new Error('unread');
    expect(toAnswer(G, read.reading)).toEqual({ kind: 'list', labels: ['Red', 'Green'] });
  });
});

describe('learned aliases', () => {
  const learned = (
    phrase: string,
    optionId: string,
    over: Partial<AliasEntry> = {},
  ): AliasEntry => ({
    phrase,
    nodeId: 'choice.shape',
    optionId,
    locale: 'en',
    source: 'user-confirmed',
    createdAt: '2026-09-28',
    count: 1,
    notes: '',
    ...over,
  });
  const wanted = (phrase: string, optionId: string, nodeId = 'choice.shape') => ({
    phrase,
    nodeId,
    optionId,
    locale: 'en' as const,
  });

  it('are read like the built-in ones once remembered', () => {
    const aliases = [...BUILTIN_ALIASES, learned('blobby', 'pill')];
    expect(
      interpret('blobby', { graph: G, nodeId: 'choice.shape', locale: 'en-GB', aliases }),
    ).toMatchObject({ outcome: 'apply', reading: { optionId: 'pill', tier: 'T0' } });
  });

  it('are refused when they would say something else, or nothing', () => {
    expect(aliasRefusal(G, wanted('blobby', 'pill'), BUILTIN_ALIASES)).toBeNull();
    // Learned never overrides built-in: "pills" already means the pill shape.
    expect(aliasRefusal(G, wanted('pills', 'square'), BUILTIN_ALIASES)).toEqual({
      reason: 'collision',
      means: 'pill',
    });
    expect(aliasRefusal(G, wanted('PILLS!', 'pill'), BUILTIN_ALIASES)).toEqual({
      reason: 'present',
    });
    expect(aliasRefusal(G, wanted('square', 'pill'), [])).toEqual({ reason: 'shadows-id' });
    expect(aliasRefusal(G, wanted('?!', 'pill'), [])).toEqual({ reason: 'empty' });
    expect(aliasRefusal(G, wanted('x'.repeat(81), 'pill'), [])).toEqual({ reason: 'too-long' });
    expect(aliasRefusal(G, wanted('blobby', 'pill', 'no.such'), [])).toEqual({
      reason: 'unknown-node',
    });
    expect(aliasRefusal(G, wanted('blobby', 'star'), [])).toEqual({ reason: 'unknown-option' });
  });

  it('that name something the graph no longer has are kept, and inert', () => {
    expect(aliasInert(G, learned('blobby', 'pill'))).toBe(false);
    expect(aliasInert(G, learned('blobby', 'star'))).toBe(true);
  });

  it('import as a diff — added, already there, refused and why — and a file cannot contradict itself', () => {
    const file = AliasFile.parse({
      aliasesVersion: 1,
      entries: [
        learned('blobby', 'pill'),
        learned('blobby', 'square'),
        learned('pills', 'pill'),
        learned('capsule-ish', 'star'),
      ],
    });
    const diff = aliasImportDiff(G, file, BUILTIN_ALIASES, '2026-09-29');
    expect(diff.added).toEqual([
      learned('blobby', 'pill', { source: 'imported', createdAt: '2026-09-29' }),
    ]);
    expect(diff.present.map((e) => e.phrase)).toEqual(['pills']);
    // In the file's canonical order: node, option, phrase.
    expect(diff.refused.map((r) => [r.entry.phrase, r.entry.optionId, r.reason, r.means])).toEqual([
      ['blobby', 'square', 'collision', 'pill'],
      ['capsule-ish', 'star', 'unknown-option', undefined],
    ]);
  });
});
