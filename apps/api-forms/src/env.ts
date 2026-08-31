import { config } from 'dotenv';
import { z } from 'zod';

config({ path: ['.env', '../../.env'] });

const Env = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://throwpaper:throwpaper@localhost:5432/throwpaper'),
  API_FORMS_PORT: z.coerce.number().int().default(4001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = Env.parse(process.env);
