import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { satisfiable } from './licence-check.js';

/**
 * The skills in `.claude/skills/` are other people's words and scripts, copied at a pinned commit
 * and recorded in its `SOURCES.json`. A skill is loaded into every session as instructions, so a
 * change to one is a change to how every agent here works: it is made on purpose, by copying again
 * from upstream, or it fails here. Each folder's hash is over its files' paths and contents.
 */
const SKILLS = join(import.meta.dirname, '..', '.claude', 'skills');

type Skill = { name: string; from: string; leftOut: string[]; patches: string[]; tree: string };
type Upstream = {
  repository: string;
  commit: string;
  licence: string;
  licenceFiles: string[];
  skills: Skill[];
};
const sources = JSON.parse(readFileSync(join(SKILLS, 'SOURCES.json'), 'utf8')) as {
  upstreams: Upstream[];
};

function filesIn(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesIn(dir, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    )
    .sort();
}

/** A folder's hash: each file's path and the hash of its bytes, one line each, in path order. */
function treeHash(dir: string): string {
  const lines = filesIn(dir).map(
    (path) =>
      `${path}\0${createHash('sha256')
        .update(readFileSync(join(dir, path)))
        .digest('hex')}\n`,
  );
  return createHash('sha256').update(lines.join('')).digest('hex');
}

const recorded = sources.upstreams.flatMap((upstream) => upstream.skills);

describe('the skills copied into .claude/skills', () => {
  it.each(recorded.map((skill) => [skill.name, skill] as const))(
    '%s is exactly the recorded copy',
    (name, skill) => {
      expect(treeHash(join(SKILLS, name)), `${name}: copy it again, or record the new hash`).toBe(
        skill.tree,
      );
    },
  );

  it('records every skill folder there is, and nothing that is not there', () => {
    const folders = readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'licenses')
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual(recorded.map((skill) => skill.name).sort());
  });

  it('comes from a pinned commit, under a licence the dependencies would be allowed', () => {
    for (const upstream of sources.upstreams) {
      expect(upstream.commit, upstream.repository).toMatch(/^[0-9a-f]{40}$/);
      expect(satisfiable(upstream.licence), upstream.repository).toBe(true);
      for (const file of upstream.licenceFiles)
        expect(readFileSync(join(SKILLS, file), 'utf8').length, file).toBeGreaterThan(0);
    }
  });
});
