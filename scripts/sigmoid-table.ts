/**
 * Writes `packages/shared/src/interpret/sigmoid.json`, the committed sigmoid (ADR 0019), from the
 * integer series in `sigmoid-table.ts`. Run it only when the table's range or step changes on
 * purpose: `pnpm exec tsx scripts/sigmoid-table.ts`. `sigmoid.test.ts` fails when the file and the
 * series disagree.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SIGMOID_FROM,
  SIGMOID_STEP,
  SIGMOID_TO,
  sigmoidTableValues,
} from '../packages/shared/src/interpret/sigmoid-table.js';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const target = join(ROOT, 'packages', 'shared', 'src', 'interpret', 'sigmoid.json');

const values = sigmoidTableValues();
const rows: string[] = [];
for (let i = 0; i < values.length; i += 20) rows.push(`    ${values.slice(i, i + 20).join(', ')}`);

writeFileSync(
  target,
  `{
  "source": "round(1000 / (1 + e^(-x / 1000))) for x in millinats; scripts/sigmoid-table.ts, from the integer series in packages/shared/src/interpret/sigmoid-table.ts",
  "sigmoidVersion": 1,
  "from": ${SIGMOID_FROM},
  "to": ${SIGMOID_TO},
  "step": ${SIGMOID_STEP},
  "values": [
${rows.join(',\n')}
  ]
}
`,
);
// Laid out as every other JSON file in the repository is, so that `format:check` passes.
execFileSync('pnpm', ['exec', 'prettier', '--write', target], { stdio: 'inherit' });
console.log(
  `sigmoid.json: ${values.length} values, ${SIGMOID_FROM}..${SIGMOID_TO} by ${SIGMOID_STEP}`,
);
