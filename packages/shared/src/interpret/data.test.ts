import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILDER_GRAPH } from '../builder/graph/nodes.js';
import {
  AliasFile,
  AnswersFile,
  BUILTIN_ALIASES,
  BUILTIN_ALIAS_FILES,
  BUILTIN_ANSWERS_FILE,
  aliasProblems,
  formatAliasFile,
  formatAnswersFile,
  type AliasEntry,
} from './aliases.js';
import { LANGUAGES, lexiconFor } from './lexicon.js';
import { isCjk, phraseTokens } from './text.js';

/**
 * The ladder's data — the word lists in `gazetteers/` and the aliases in `aliases/` — held to
 * what `INTENT-LADDER.md` says of them (ADR 0021: JSON, schema-validated on load, the same data
 * always the same bytes).
 */

const aliasPath = (language: string) => new URL(`./aliases/${language}.json`, import.meta.url);

describe('the shared answers', () => {
  const file = AnswersFile.parse(BUILTIN_ANSWERS_FILE);
  const guess = BUILDER_GRAPH.nodes.filter(
    (node) => node.group === 'guess' && node.kind === 'question',
  );

  it('are exactly the bytes they give', () => {
    const bytes = readFileSync(new URL('./aliases/answers.json', import.meta.url), 'utf8');
    expect(formatAnswersFile(AnswersFile.parse(JSON.parse(bytes)))).toBe(bytes);
  });

  it('list every guess question, and give each the same ways in every language', () => {
    expect(file.nodes).toEqual(guess.map((node) => node.id).sort());
    for (const language of LANGUAGES) {
      const ways = (nodeId: string) =>
        BUILTIN_ALIASES.filter((a) => a.locale === language && a.nodeId === nodeId)
          .map((a) => `${a.optionId}:${a.phrase}`)
          .sort();
      const first = ways(guess[0]!.id);
      expect(first.length).toBeGreaterThanOrEqual(9);
      for (const node of guess) expect(ways(node.id)).toEqual(first);
    }
  });

  it.each<[string, (f: AnswersFile) => AnswersFile, string]>([
    ['a question left out', (f) => ({ ...f, nodes: f.nodes.slice(1) }), 'uncovered'],
    [
      'a question the graph lacks',
      (f) => ({ ...f, nodes: [...f.nodes, 'guess.nothing'] }),
      'unknown-node',
    ],
    [
      'a question whose cards are not yes, no and not sure',
      (f) => ({ ...f, nodes: [...f.nodes, 'text.required'] }),
      'unknown-option',
    ],
    ['not the schema', (f) => ({ ...f, answersVersion: 2 as 1 }), 'schema'],
  ])('%s is caught', (_name, spoil, rule) => {
    expect(
      aliasProblems(BUILDER_GRAPH, BUILTIN_ALIAS_FILES, spoil(file)).map((p) => p.rule),
    ).toContain(rule);
  });
});

describe('the alias files', () => {
  it('pass every check against the graph', () => {
    expect(aliasProblems(BUILDER_GRAPH)).toEqual([]);
  });

  it.each(LANGUAGES)('%s is exactly the bytes its entries give', (language) => {
    const bytes = readFileSync(aliasPath(language), 'utf8');
    expect(formatAliasFile(AliasFile.parse(JSON.parse(bytes)))).toBe(bytes);
  });

  it('writes the same bytes whatever order the entries come in', () => {
    const file = AliasFile.parse(BUILTIN_ALIAS_FILES.sv);
    const reversed = { ...file, entries: [...file.entries].reverse() };
    expect(formatAliasFile(reversed)).toBe(formatAliasFile(file));
  });

  describe('each rule catches its mistake', () => {
    const sv = AliasFile.parse(BUILTIN_ALIAS_FILES.sv);
    const withSv = (entries: AliasEntry[]) => ({ ...BUILTIN_ALIAS_FILES, sv: { ...sv, entries } });
    const entry = (over: Partial<AliasEntry>): AliasEntry => ({ ...sv.entries[0]!, ...over });
    const rules = (entries: AliasEntry[]) =>
      aliasProblems(BUILDER_GRAPH, withSv(entries)).map((p) => p.rule);

    it.each<[string, () => AliasEntry[], string]>([
      [
        'a node the graph lacks',
        () => [...sv.entries, entry({ nodeId: 'no.such', phrase: 'x' })],
        'unknown-node',
      ],
      [
        'an option the node lacks',
        () => [...sv.entries, entry({ optionId: 'nope', phrase: 'x' })],
        'unknown-option',
      ],
      ['a phrase of punctuation', () => [...sv.entries, entry({ phrase: '!!!' })], 'empty'],
      [
        'another language’s entry',
        () => [...sv.entries, entry({ locale: 'en', phrase: 'zz' })],
        'locale',
      ],
      [
        'a learned alias shipped',
        () => [...sv.entries, entry({ source: 'imported', phrase: 'zz' })],
        'source',
      ],
      [
        'one phrase for two options',
        () => [...sv.entries, entry({ nodeId: 'choice.shape', optionId: 'pill', phrase: 'rund' })],
        'collision',
      ],
      [
        'another option’s id',
        () => [
          ...sv.entries,
          entry({ nodeId: 'choice.shape', optionId: 'pill', phrase: 'Square' }),
        ],
        'shadows-id',
      ],
      [
        'an option nobody can type',
        () => sv.entries.filter((e) => e.optionId !== 'tile'),
        'uncovered',
      ],
    ])('%s', (_name, entries, rule) => {
      expect(rules(entries())).toContain(rule);
    });

    it('entries out of order', () => {
      expect(rules([...sv.entries].reverse())).toContain('order');
    });
  });
});

describe('the word lists', () => {
  it.each(LANGUAGES)('%s writes 0–20, the tens and 100', (language) => {
    const lexicon = lexiconFor(language);
    const values = new Set(lexicon.numbers.map((n) => n.value));
    const wanted = [...Array.from({ length: 21 }, (_, i) => i), 30, 40, 50, 60, 70, 80, 90, 100];
    if (lexicon.numerals.size > 0) {
      // Chinese and Japanese compose: the digits, ten and a hundred are enough.
      expect([...lexicon.numerals.values()].sort((a, b) => a - b)).toEqual(
        expect.arrayContaining([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100]),
      );
      return;
    }
    expect(wanted.filter((n) => !values.has(n))).toEqual([]);
  });

  it.each(LANGUAGES)(
    '%s has stop words that are single tokens, and never a keyword it needs',
    (language) => {
      const lexicon = lexiconFor(language);
      for (const word of lexicon.stopWords) {
        const cjk = [...word].some(isCjk);
        if (cjk) expect([...word].length, word).toBeLessThanOrEqual(2);
        else
          expect(
            phraseTokens(word).map((t) => t.text),
            word,
          ).toEqual([word]);
      }
      // A stop word that negates or is vague would silently stop doing either.
      for (const phrase of [...lexicon.negators, ...lexicon.vague]) {
        expect(lexicon.stopWords.has(phrase.text), phrase.text).toBe(false);
      }
      for (const n of lexicon.numbers) expect(lexicon.stopWords.has(n.text), n.text).toBe(false);
    },
  );

  it('reads the same word lists in every language file as the language it names', () => {
    for (const language of LANGUAGES) expect(lexiconFor(language).language).toBe(language);
  });
});
