import type { FormTemplate } from './templates.js';

/**
 * "What do you want to make?" — a few typed words, read as a template or a part of the app.
 *
 * Hard-coded and rule-based, like the guided builder: no model, no network, the same words give the
 * same answer on every machine (`docs/plan/EASY.md`, E5). A person who types "PoA", "birthday" or
 * "contract" should never meet a catalogue.
 *
 * - Keywords are written in English and Swedish. Every template's own name, in all twelve
 *   languages, is a keyword too, so "Vollmacht" or "Valtakirja" works without a list of its own.
 * - There is no contract, waiver, consent or rental template and none is invented here (CLAUDE.md
 *   rule 8): "contract" leads to Get something signed, where a human's document is signed.
 * - To teach it a word, add it to a row below and a case to `ask.test.ts`.
 */

export type AskRoute = 'sign' | 'scan' | 'send';

export const ROUTE_PATHS: Record<AskRoute, string> = {
  sign: '/signing',
  scan: '/scan',
  send: '/send',
};

/** Template id → words that mean it. Whole phrases; a word matches from its start ("birthdays"). */
export const TEMPLATE_KEYWORDS: Record<string, readonly string[]> = {
  rsvp: [
    'rsvp',
    'party',
    'birthday',
    'bday',
    'wedding',
    'invite',
    'invitation',
    'baby shower',
    'housewarming',
    'dinner',
    'barbecue',
    'bbq',
    'graduation',
    'christening',
    'reunion',
    'gathering',
    'kalas',
    'fest',
    'fodelsedag',
    'brollop',
    'inbjudan',
    'bjudning',
    'middag',
    'osa',
    'dop',
    'student',
    'examen',
    'grillfest',
    'julbord',
    'afterwork',
  ],
  'event-registration': [
    'event',
    'registration',
    'register',
    'sign up',
    'signup',
    'sign-up',
    'evenemang',
    'arrangemang',
    'anmalan',
    'anmal',
    'happening',
    'festival',
    'fair',
    'market',
    'marknad',
    'lopp',
    'race',
    'tavling',
    'competition',
    'tournament',
    'turnering',
  ],
  'contact-enquiry': [
    'contact',
    'enquiry',
    'inquiry',
    'get in touch',
    'question',
    'message us',
    'kontakt',
    'fraga',
    'forfragan',
    'kontakta oss',
  ],
  'customer-feedback': [
    'feedback',
    'review',
    'testimonial',
    'complaint',
    'rate us',
    'omdome',
    'aterkoppling',
    'synpunkt',
    'klagomal',
    'betyg',
  ],
  'satisfaction-survey': [
    'survey',
    'poll',
    'questionnaire',
    'satisfaction',
    'nps',
    'quiz',
    'enkat',
    'undersokning',
    'omrostning',
    'kundnojdhet',
  ],
  'course-signup': [
    'course',
    'class',
    'workshop',
    'lesson',
    'training',
    'lecture',
    'seminar',
    'camp',
    'kurs',
    'utbildning',
    'lektion',
    'foredrag',
    'traning',
    'lager',
    'skola',
    'school',
    'tutoring',
  ],
  'booking-request': [
    'booking',
    'book',
    'appointment',
    'reservation',
    'reserve',
    'table',
    'haircut',
    'massage',
    'tid',
    'bokning',
    'boka',
    'tidsbokning',
    'besok',
    'visit',
    'viewing',
    'visning',
  ],
  'quote-request': [
    'quote',
    'quotation',
    'estimate',
    'price request',
    'offert',
    'prisforfragan',
    'kostnadsforslag',
    'prisforslag',
    'pris',
  ],
  'support-request': [
    'support',
    'help',
    'ticket',
    'issue',
    'bug',
    'problem',
    'helpdesk',
    'repair',
    'hjalp',
    'fel',
    'arende',
    'felanmalan',
    'reparation',
    'service',
  ],
  'job-application': [
    'job',
    'application',
    'apply',
    'cv',
    'resume',
    'career',
    'hiring',
    'recruit',
    'vacancy',
    'jobb',
    'ansokan',
    'rekrytering',
    'anstallning',
    'tjanst',
    'sommarjobb',
  ],
  'volunteer-signup': [
    'volunteer',
    'helper',
    'helpers',
    'charity',
    'frivillig',
    'ideell',
    'volontar',
    'hjalpare',
    'insamling',
  ],
  'member-details': [
    'member',
    'membership',
    'join',
    'club',
    'medlem',
    'medlemskap',
    'medlemsanmalan',
    'forening',
    'association',
  ],
  'newsletter-signup': [
    'newsletter',
    'mailing list',
    'subscribe',
    'subscription',
    'nyhetsbrev',
    'prenumerera',
    'prenumeration',
    'mejlista',
    'utskick',
  ],
  'suggestion-box': [
    'suggestion',
    'idea',
    'ideas',
    'suggest',
    'forslag',
    'ide',
    'forslagslada',
    'tips',
  ],
  'facility-booking': [
    'room',
    'venue',
    'hall',
    'facility',
    'laundry',
    'court',
    'pitch',
    'sauna',
    'lokal',
    'samlingslokal',
    'tvattstuga',
    'bastu',
    'gym',
    'hyra',
    'rent a room',
    'meeting room',
  ],
  'absence-notice': [
    'absence',
    'sick',
    'sick leave',
    'leave',
    'vacation',
    'holiday request',
    'time off',
    'day off',
    'frånvaro',
    'franvaro',
    'sjuk',
    'sjukanmalan',
    'ledighet',
    'semester',
    'vab',
    'ledig',
  ],
  'motion-submission': ['motion', 'resolution', 'motion till'],
  'meeting-proxy': ['proxy', 'proxy vote', 'ombud', 'ombudsfullmakt', 'vote for me'],
  'general-meeting-registration': [
    'agm',
    'annual general meeting',
    'general meeting',
    'annual meeting',
    'shareholder',
    'egm',
    'arsmote',
    'bolagsstamma',
    'stamma',
    'foreningsmote',
    'extra stamma',
    'arsstamma',
  ],
  'power-of-attorney': [
    'poa',
    'power of attorney',
    'attorney',
    'authorise',
    'authorize',
    'on my behalf',
    'fullmakt',
    'behorighet',
    'vollmacht',
    'fuldmagt',
    'valtakirja',
    'procuration',
    'poder notarial',
  ],
  'conference-registration': [
    'conference',
    'symposium',
    'convention',
    'summit',
    'congress',
    'konferens',
    'kongress',
  ],
  'lab-observation': [
    'lab',
    'observation',
    'experiment',
    'field notes',
    'fieldwork',
    'laboratorie',
    'fältanteckning',
    'faltanteckning',
    'forsok',
  ],
  'sample-submission': ['sample', 'specimen', 'prov', 'provinlamning', 'lab sample'],
};

/** Words for the parts of the app that are not forms. */
export const ROUTE_KEYWORDS: Record<AskRoute, readonly string[]> = {
  sign: [
    'contract',
    'agreement',
    'sign',
    'signature',
    'esign',
    'e-sign',
    'nda',
    'lease',
    'kontrakt',
    'avtal',
    'signera',
    'underskrift',
    'hyresavtal',
    'anstallningsavtal',
  ],
  scan: ['scan', 'scanner', 'skanna', 'skanning', 'photo of a paper', 'pdf'],
  send: ['send a file', 'send file', 'send an email', 'skicka fil', 'skicka mejl', 'skicka filer'],
};

export type AskReading =
  { kind: 'template'; ids: string[] } | { kind: 'route'; route: AskRoute } | { kind: 'none' };

/** Lower case, no accents: "Fullmäktige" and "fullmaktige" read the same. */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const NO_SPACES = /[぀-ヿ㐀-鿿]/u;
const WORD = /[\p{L}\p{N}]/u;

/** How well one phrase reads in the text: its length, or 0. Starts a word; three letters or fewer is a whole word. */
function hit(text: string, phrase: string): number {
  if (!phrase) return 0;
  const haystack = ` ${text} `;
  const whole = phrase.length <= 3;
  const unspaced = NO_SPACES.test(phrase);
  for (let at = haystack.indexOf(phrase); at !== -1; at = haystack.indexOf(phrase, at + 1)) {
    if (unspaced) return phrase.length;
    if (WORD.test(haystack[at - 1] ?? ' ')) continue;
    if (whole && WORD.test(haystack[at + phrase.length] ?? ' ')) continue;
    return phrase.length;
  }
  return 0;
}

/**
 * What the words mean. Templates are returned best first (at most three); a route only when it beats
 * every template. Nothing known → `none`, and the caller asks questions instead.
 */
export function readAsk(text: string, templates: readonly FormTemplate[]): AskReading {
  const said = plain(text);
  if (!said) return { kind: 'none' };
  const scores: { id: string; score: number }[] = [];
  for (const template of templates) {
    const names = Object.values(template.name).map(plain);
    const words = (TEMPLATE_KEYWORDS[template.id] ?? []).map(plain);
    let score = 0;
    // A template's name counts a little less than a word chosen for it, so two templates that share
    // a name in one language ("Vollmacht") fall to the one that lists it.
    for (const phrase of names)
      score = Math.max(score, hit(said, phrase) && hit(said, phrase) - 0.5);
    for (const phrase of words) score = Math.max(score, hit(said, phrase));
    if (score > 0) scores.push({ id: template.id, score });
  }
  scores.sort((a, b) => b.score - a.score);
  let route: { route: AskRoute; score: number } | null = null;
  for (const name of Object.keys(ROUTE_KEYWORDS) as AskRoute[]) {
    for (const phrase of ROUTE_KEYWORDS[name].map(plain)) {
      const score = hit(said, phrase);
      if (score > (route?.score ?? 0)) route = { route: name, score };
    }
  }
  const best = scores[0]?.score ?? 0;
  if (route && route.score > best) return { kind: 'route', route: route.route };
  if (scores.length === 0) return { kind: 'none' };
  return { kind: 'template', ids: scores.slice(0, 3).map((s) => s.id) };
}
