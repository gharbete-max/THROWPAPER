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
  /**
   * Signs access tokens. No default — a predictable secret mints admin sessions.
   * Optional here so db:migrate and db:seed, which never sign anything, do not need one;
   * main.ts refuses to start the server without it.
   */
  JWT_SECRET: z.string().min(32).optional(),
  /** Base URL of apps/forms, used to build magic links and to scope CORS. */
  APP_URL: z.string().url().default('http://localhost:5173'),
});

export const env = Env.parse(process.env);
