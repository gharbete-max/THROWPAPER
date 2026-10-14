import { SUMMARY_LOCALES, type SummaryLocale } from './languages.js';
import { digitCheck } from './check.js';

/**
 * The email reply helper's pure parts (docs/plan/AI-SYSTEM.md D6): what is asked of the model, how
 * a received message is made safe to quote as data, and the checks that go around the draft.
 *
 * No model runs here. The prompts are in `apps/desktop/src/ai/text/prompts.ts`; what is decided
 * about the draft afterwards is here, so the desktop pipeline and the window apply the very same
 * rules to the draft the model wrote and to the draft the person has since edited.
 */

export const REPLY_TONES = ['professional', 'friendly', 'concise', 'formal', 'firm'] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

/** Characters, so a limit means the same in every script. */
export const REPLY_LIMITS = {
  received: 20_000,
  notes: 4_000,
  draft: 8_000,
  instruction: 500,
} as const;

/**
 * `received` is the other person's message: UNTRUSTED. `notes` are the writer's own words. They
 * are on every kind because the number check compares the draft with both; the kinds that work on
 * an existing draft do not put either of them in the prompt (a smaller surface for an injection).
 */
interface ReplyContext {
  received: string;
  notes: string;
  /** The language the draft is written in; for `translate-reply` the one it is translated into. */
  into: SummaryLocale;
  tone: ReplyTone;
}

export type ReplyTask =
  | ({ kind: 'draft-reply' } & ReplyContext)
  | ({ kind: 'shorten-reply'; draft: string } & ReplyContext)
  | ({ kind: 'translate-reply'; draft: string } & ReplyContext)
  | ({ kind: 'revise-reply'; draft: string; instruction: string } & ReplyContext);

export const REPLY_KINDS = [
  'draft-reply',
  'shorten-reply',
  'translate-reply',
  'revise-reply',
] as const satisfies ReadonlyArray<ReplyTask['kind']>;

/** The shape of a task that arrives from a window. Text is not inspected, only its type and size. */
export function isReplyTask(value: unknown): value is ReplyTask {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  const str = (key: string, max: number, required = false) =>
    typeof task[key] === 'string' &&
    (task[key] as string).length <= max &&
    (!required || (task[key] as string).trim() !== '');
  if (!(REPLY_KINDS as readonly unknown[]).includes(task.kind)) return false;
  if (!str('received', REPLY_LIMITS.received) || !str('notes', REPLY_LIMITS.notes)) return false;
  if (!(SUMMARY_LOCALES as readonly unknown[]).includes(task.into)) return false;
  if (!(REPLY_TONES as readonly unknown[]).includes(task.tone)) return false;
  if (task.kind === 'draft-reply') return true;
  if (!str('draft', REPLY_LIMITS.draft, true)) return false;
  return task.kind !== 'revise-reply' || str('instruction', REPLY_LIMITS.instruction, true);
}

/** Zero-width, bidirectional-control, soft-hyphen and "tag" characters: ways to hide text. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁯﻿\u{E0000}-\u{E007F}]/gu;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ANGLES = /[<＜﹤]/g;
const ANGLES_CLOSE = /[>＞﹥]/g;

/**
 * Makes text safe to place between our own tags as quoted data. Hidden characters are removed, and
 * every angle bracket (also the full-width ones) becomes a single guillemet, so nothing inside can
 * close the tag it is in or open one of ours, and pasted HTML reads as plain text.
 */
export function quoteAsData(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(ANGLES, '‹')
    .replace(ANGLES_CLOSE, '›')
    .trim();
}

/** Marked gaps the writer must fill: `[date?]`, `[price?]`. */
const PLACEHOLDER = /\[[^[\]\n]{1,24}\?\]/g;
export function placeholdersIn(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

/** Words that name or imply something attached. A reply written here never has an attachment. */
const ATTACHMENT =
  /attach|enclos|bifog|bilag|bilaga|vedhæft|vedlag|vedleg|anhang|angehängt|beigef|anbei|adjunt|ci-joint|pièce jointe|liite|liitte|oheis|viðhengi|meðfylgjandi|вложен|приложен|прикреплен|添付|附件|附上|随附/iu;
export function mentionsAttachment(text: string): boolean {
  return ATTACHMENT.test(text);
}

type Code = 'en' | 'sv' | 'da' | 'nb' | 'de' | 'es' | 'fr' | 'fi' | 'is' | 'ru' | 'ja' | 'zh';

const words = (list: string) => new Set(list.split(' '));
const STOP: Record<Exclude<Code, 'ru' | 'ja' | 'zh'>, Set<string>> = {
  en: words(
    'the and of to in is are was were for with that this will be on at by from have has not as it we our',
  ),
  sv: words(
    'och att det som en är av för med på den till har de inte om ett vi kan ska från vid också',
  ),
  da: words(
    'og at det som en er af for med på den til har de ikke om et vi kan skal fra ved også blev',
  ),
  nb: words(
    'og at det som en er av for med på den til har de ikke om et vi kan skal fra ved også ble',
  ),
  de: words(
    'und der die das ist nicht mit für auf den dem zu von ein eine wir wird werden im auch bei',
  ),
  es: words('de la el en y que los las del se por con para un una es al su más como fue'),
  fr: words(
    'de la le les des et en un une est pour que dans du au sur par avec sont a été pas nous',
  ),
  fi: words(
    'ja on ei että se oli kun myös mutta tai ovat joka vuoden kokous jäsentä päätti kello hallitus',
  ),
  is: words('og að er í á við til sem með var fyrir ekki það en frá um af hefur eru verður sér'),
};
const NB_ONLY = words('ble av noe hva å vedtok møtet');
const DA_ONLY = words('blev af noget hvad mødet besluttede');

/**
 * Which language a text is in, by script share (Cyrillic, Han, kana) or a stop-word count for the
 * Latin ones: the heuristic of spike S1 (docs/plan/SUMMARY-SPIKE.md, "Mechanical checks"). Null
 * when the text is too short to say. It is a hint, never a safeguard: Bokmål against Danish is
 * unreliable, so the two are compared as one group below.
 */
export function detectLanguage(text: string): Code | null {
  const plain = text.replace(PLACEHOLDER, ' ');
  const letters = [...plain].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 12) return null;
  const share = (re: RegExp) => letters.filter((c) => re.test(c)).length / letters.length;
  if (share(/\p{Script=Cyrillic}/u) > 0.5) return 'ru';
  const han = share(/\p{Script=Han}/u);
  const kana = share(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  if (han + kana > 0.5) return kana > 0.05 ? 'ja' : 'zh';
  const tokens = plain.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (tokens.length < 5) return null;
  let best: Code | null = null;
  let top = 0;
  for (const [code, list] of Object.entries(STOP) as Array<[Code, Set<string>]>) {
    const score = tokens.filter((w) => list.has(w)).length / tokens.length;
    if (score > top) {
      top = score;
      best = code;
    }
  }
  if (top < 0.08) return null;
  if (best === 'nb' || best === 'da') {
    const nb = tokens.filter((w) => NB_ONLY.has(w)).length;
    const da = tokens.filter((w) => DA_ONLY.has(w)).length;
    if (nb !== da) best = nb > da ? 'nb' : 'da';
  }
  return best;
}

const CODE_OF: Record<SummaryLocale, Code> = {
  'da-DK': 'da',
  'de-DE': 'de',
  'en-GB': 'en',
  'es-ES': 'es',
  'fi-FI': 'fi',
  'fr-FR': 'fr',
  'is-IS': 'is',
  'ja-JP': 'ja',
  'nb-NO': 'nb',
  'ru-RU': 'ru',
  'sv-SE': 'sv',
  'zh-CN': 'zh',
};

/** The language to answer in: that of the message, when it can be told. */
export function localeOfText(text: string): SummaryLocale | null {
  const code = detectLanguage(text);
  return code ? (SUMMARY_LOCALES.find((locale) => CODE_OF[locale] === code) ?? null) : null;
}

/** Danish and Bokmål are one group: the detector cannot reliably tell them apart. */
const group = (code: Code): string => (code === 'da' || code === 'nb' ? 'dano' : code);

export function isInLanguage(text: string, into: SummaryLocale): boolean {
  const found = detectLanguage(text);
  return found === null || group(found) === group(CODE_OF[into]);
}

export interface ReplyFlags {
  /** Numbers in the draft that the message, the notes and the instructions do not have. */
  invented: string[];
  attachment: boolean;
  wrongLanguage: boolean;
  /** Gaps still to fill in. */
  placeholders: number;
}

/**
 * The checks on a draft. `reference` is everything the draft may take its numbers from: the
 * received message, the writer's notes and any instruction the writer gave. The draft itself is
 * never part of it, so a number the model invented stays flagged through every shorter and
 * translated version until the writer has dealt with it.
 */
export function replyFlags(
  draft: string,
  reference: readonly string[],
  into: SummaryLocale,
): ReplyFlags {
  return {
    invented: digitCheck(reference.join('\n'), draft).added,
    attachment: mentionsAttachment(draft),
    wrongLanguage: !isInLanguage(draft, into),
    placeholders: placeholdersIn(draft).length,
  };
}
