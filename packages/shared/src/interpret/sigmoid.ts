import { z } from 'zod';
import table from './sigmoid.json';

/**
 * The committed sigmoid — ADR 0019: `round(1000 / (1 + e^(−x / 1000)))`, a confidence in per mille
 * for a score in millinats, read from a table rather than computed with `Math.exp`, so that every
 * machine gives the same integer and no threshold can flip on an engine's last bit. Shared by the
 * importer's scores (`IMPORT-PIPELINE.md` §5 and §7) and, from S11, the belief engine.
 */

const SigmoidSchema = z
  .object({
    source: z.string().min(1),
    sigmoidVersion: z.literal(1),
    from: z.literal(-8000),
    to: z.literal(8000),
    step: z.literal(50),
    values: z.array(z.number().int().min(0).max(1000)).length(321),
  })
  .strict();

const SIGMOID = SigmoidSchema.parse(table);

/**
 * 1000 × σ(x / 1000) for a score of x millinats, rounded: the value at the nearest step (halves
 * up), and 0 or 1000 beyond the table, which is as close as per mille can get there.
 */
export function sigmoidMille(millinats: number): number {
  if (!Number.isSafeInteger(millinats)) throw new TypeError(`sigmoidMille: ${millinats}`);
  const x = Math.min(SIGMOID.to, Math.max(SIGMOID.from, millinats));
  const index = Math.floor((x - SIGMOID.from + SIGMOID.step / 2) / SIGMOID.step);
  return SIGMOID.values[index]!;
}
