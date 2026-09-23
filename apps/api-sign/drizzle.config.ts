import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Read the environment directly, as api-forms does: drizzle-kit's resolver does not follow the
// .js-to-.ts mapping src/ relies on.
config({ path: ['.env', '../../.env'] });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.SIGN_DATABASE_URL ??
      'postgres://throwpaper:throwpaper@localhost:5432/throwpaper_sign',
  },
});
