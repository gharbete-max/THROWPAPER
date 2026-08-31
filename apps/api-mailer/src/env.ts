import { config } from 'dotenv';
import { z } from 'zod';

config({ path: ['.env', '../../.env'] });

const Env = z.object({
  API_MAILER_PORT: z.coerce.number().int().default(4002),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = Env.parse(process.env);
