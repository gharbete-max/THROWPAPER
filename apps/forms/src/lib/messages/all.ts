import type { Catalogue } from '@tp/i18n';
import { enGB, type MessageKey } from './en-GB.js';
import { svSE } from './sv-SE.js';
import { daDK } from './da-DK.js';
import { nbNO } from './nb-NO.js';
import { fiFI } from './fi-FI.js';
import { isIS } from './is-IS.js';
import { frFR } from './fr-FR.js';
import { deDE } from './de-DE.js';
import { esES } from './es-ES.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { ruRU } from './ru-RU.js';

/**
 * Every catalogue at once — **for tests and tooling, never for the app**.
 *
 * The app loads one language at a time (see `index.ts`); importing this module pulls all twelve
 * into whatever bundle reaches it, which is exactly the regression the split exists to avoid.
 * `bundle-split.test.ts` fails if application code imports it.
 *
 * The completeness checks need every language in one place, so this is where they get it.
 */
export const ALL_CATALOGUES: Record<string, Record<MessageKey, string>> = {
  'en-GB': enGB,
  'sv-SE': svSE,
  'da-DK': daDK,
  'nb-NO': nbNO,
  'fi-FI': fiFI,
  'is-IS': isIS,
  'fr-FR': frFR,
  'de-DE': deDE,
  'es-ES': esES,
  'zh-CN': zhCN,
  'ja-JP': jaJP,
  'ru-RU': ruRU,
};

/** Key-major, the shape `createTranslator` wants. */
export const messages: Catalogue = Object.fromEntries(
  (Object.keys(enGB) as MessageKey[]).map((key) => [
    key,
    Object.fromEntries(
      Object.entries(ALL_CATALOGUES).map(([locale, catalogue]) => [locale, catalogue[key]]),
    ),
  ]),
);
