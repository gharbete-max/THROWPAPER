import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyDefinition } from '../forms/definition.js';
import { jsonEqual } from './changes.js';
import { BUILDER_GRAPH } from './graph/nodes.js';
import { answer, begin, type Answer } from './machine.js';
import { BuilderSession, fromSession, MAX_LOG_ENTRIES, toSession } from './session.js';

/**
 * A saved conversation comes back as it was — `CAVEATS.md` #45 (`never-lose-work`): a refresh or a
 * restart returns to the same question with the same trail. And a conversation recorded by one
 * build replays into the same draft in every later one: `fixtures/sessions/buttons-chain.json`
 * holds a recorded session and the draft it produced, and replaying it must give that draft.
 */

const G = BUILDER_GRAPH;
const locale = 'sv-SE';
const FIXTURE = new URL('../../../../fixtures/sessions/buttons-chain.json', import.meta.url);

const chain: Answer[] = [
  { kind: 'option', optionId: 'signup' },
  { kind: 'option', optionId: 'later' },
  { kind: 'text', value: 'Vilken mat vill du ha?' },
  { kind: 'option', optionId: 'yes' },
  { kind: 'option', optionId: 'yes' },
  { kind: 'option', optionId: 'one' },
  { kind: 'quantity', value: 4 },
  { kind: 'option', optionId: 'pill' },
  { kind: 'option', optionId: 'under-full' },
  { kind: 'continue' },
];
const recorded = () =>
  chain.reduce(
    (c, a) => answer(G, c, a, { locale }),
    begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: false } }),
  );

describe('a saved session', () => {
  it('comes back through JSON exactly: the same node, the same trail, the same draft', () => {
    const c = recorded();
    const stored = JSON.parse(JSON.stringify(toSession(G, c))) as unknown;
    const again = fromSession(stored);
    expect(again.state.cursor).toBe('flow.more');
    expect(jsonEqual(again, c)).toBe(true);
  });

  it('is recorded the same way by every build until someone reviews a change to it', async () => {
    const c = recorded();
    const file = { session: toSession(G, c), draft: c.state.draft };
    await expect(`${JSON.stringify(file, null, 2)}\n`).toMatchFileSnapshot(FIXTURE.pathname);
  });

  it('replays the recorded session into the draft recorded with it', () => {
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { session: unknown; draft: unknown };
    expect(jsonEqual(fromSession(file.session).state.draft, file.draft)).toBe(true);
  });
});

describe('a session that cannot be trusted', () => {
  const good = () =>
    JSON.parse(JSON.stringify(toSession(G, recorded()))) as {
      sessionVersion: number;
      base: { draft: { definition: { fields: unknown[] } } };
      log: { patch: unknown[] }[];
    };

  it.each<[string, (s: ReturnType<typeof good>) => void]>([
    ['a version this build does not read', (s) => (s.sessionVersion = 2)],
    ['a draft the form schema refuses', (s) => s.base.draft.definition.fields.push({ id: 'x' })],
    [
      'a step that does not apply',
      (s) =>
        s.log[1]!.patch.push({
          op: 'remove',
          at: ['draft', 'definition', 'fields', { id: 'nope' }],
        }),
    ],
    ['a key the format does not have', (s) => Object.assign(s, { extra: true })],
  ])('is refused as a bad session: %s', (_name, spoil) => {
    const s = good();
    spoil(s);
    expect(() => fromSession(s)).toThrow(expect.objectContaining({ code: 'bad-session' }));
  });

  it('holds at most so many steps', () => {
    const s = good();
    const step = s.log[0]!;
    s.log = Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => step);
    expect(BuilderSession.safeParse(s).success).toBe(false);
  });
});
