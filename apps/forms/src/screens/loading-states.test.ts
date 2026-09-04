import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A screen that fails to load must not look like a screen that is still loading.
 *
 * `EventReport` did. It held one piece of state for two facts:
 *
 *   const [attendance, setAttendance] = useState<Attendance | null>(null);
 *   .catch(() => setAttendance(null));
 *   if (!attendance) return <Loading />;
 *
 * `null` meant "not loaded yet" and "the load failed", and the catch set the state to the value it
 * already held — so a failure rendered the loading indicator and left it there. Following a link
 * to a deleted event, or a mistyped id, gave somebody a spinner that was never going to resolve.
 * Nothing failed loudly: the request 400'd in the network panel and the page just sat there.
 *
 * Found by walking every route in a browser and noticing one with no `<h1>` and eight characters
 * of content, which is why the check below is about the shape rather than about this one screen.
 */
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

/** Screens that load something by id and can therefore be asked for one that does not exist. */
const BY_ID = [
  'EventReport.tsx',
  'EventForm.tsx',
  'FormResponses.tsx',
  'UserWorkspace.tsx',
  'BrandKit.tsx',
];

describe('a screen that cannot load its subject', () => {
  it.each(BY_ID)('%s distinguishes failure from loading', (name) => {
    const source = read(name);

    /*
     * The failure is a catch that restores the initial value. Written out as the two spellings it
     * actually takes — `setX(null)` and `setX(undefined)` — rather than as a general rule, because
     * a catch that sets an *empty list* is a different judgement: it is wrong for a subject, and
     * defensible for a secondary list beside one.
     */
    const blindCatch = /\.catch\(\(\)\s*=>\s*set\w+\((?:null|undefined)\)\)/.exec(source);
    expect(
      blindCatch?.[0],
      `${name} answers a failed load with its own loading state`,
    ).toBeUndefined();
  });

  it('gives the attendance screen a way out rather than a spinner', () => {
    const source = read('EventReport.tsx');
    expect(source).toContain("setAttendance('failed')");
    expect(source).toContain("attendance === 'failed'");
    // Retrying the request, not reloading the page, so a filter already set survives.
    expect(source).toContain('onClick={load}');
  });
});
