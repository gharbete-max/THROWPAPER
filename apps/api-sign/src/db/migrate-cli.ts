import { env } from '../env.js';
import { migrateDatabase } from './client.js';

await migrateDatabase(env.SIGN_DATABASE_URL);
console.log('sign: migrations applied');
