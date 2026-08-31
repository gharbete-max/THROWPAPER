import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Read the environment directly rather than importing src/env — drizzle-kit loads this file with
// its own resolver, which does not follow the .js-to-.ts mapping the rest of the app relies on.
config({ path: ['.env', '../../.env'] });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://throwpaper:throwpaper@localhost:5432/throwpaper',
  },
});
