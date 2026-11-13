import { DEFAULT_FALLBACKS, type Catalogue, type LocaleConfig } from '@tp/i18n';

/**
 * The audit page's words (rule 4). Labels only: the page states what happened and hashes, never
 * what it means in law — that sentence is counsel's, not ours (rule 8, ADR 0012).
 *
 * English and Swedish to start, as every product did. A party in any other language gets the page
 * along the platform's fallback chain (Danish and Norwegian → Swedish, the rest → English).
 */
export const SEAL_LOCALES: LocaleConfig = {
  supported: ['en-GB', 'sv-SE'],
  default: 'en-GB',
  fallbacks: DEFAULT_FALLBACKS,
};

export const sealMessages: Catalogue = {
  'seal.title': { 'en-GB': 'Audit trail', 'sv-SE': 'Händelselogg' },
  'seal.product': { 'en-GB': 'Loppa Sign', 'sv-SE': 'Loppa Sign' },
  'seal.reason': { 'en-GB': 'Sealed after signing', 'sv-SE': 'Förseglad efter signering' },
  'seal.document': { 'en-GB': 'Document', 'sv-SE': 'Dokument' },
  'seal.documentSha256': {
    'en-GB': 'Document SHA-256 (as sent)',
    'sv-SE': 'Dokumentets SHA-256 (som skickat)',
  },
  'seal.envelope': { 'en-GB': 'Envelope', 'sv-SE': 'Kuvert' },
  'seal.declaration': { 'en-GB': 'Declaration', 'sv-SE': 'Försäkran' },
  'seal.declarationVersion': {
    'en-GB': '{key}, version {version}',
    'sv-SE': '{key}, version {version}',
  },
  'seal.environment': { 'en-GB': 'Environment', 'sv-SE': 'Miljö' },
  'seal.environment.test': { 'en-GB': 'Test mode', 'sv-SE': 'Testläge' },
  'seal.environment.production': { 'en-GB': 'Production', 'sv-SE': 'Skarp' },
  'seal.sealedAt': { 'en-GB': 'Sealed at', 'sv-SE': 'Förseglad' },
  'seal.timeSource': { 'en-GB': 'Time source', 'sv-SE': 'Tidskälla' },
  'seal.timeSource.tsa': {
    'en-GB':
      'Independent RFC 3161 timestamp from {tsa}, embedded in the seal. A PDF reader that validates signatures shows it.',
    'sv-SE':
      'Oberoende RFC 3161-tidsstämpel från {tsa}, inbäddad i förseglingen. En PDF-läsare som validerar signaturer visar den.',
  },
  'seal.timeSource.clock': {
    'en-GB':
      "This computer's clock, not independently verified: no timestamp service could be reached.",
    'sv-SE':
      'Den här datorns klocka, inte oberoende verifierad: ingen tidsstämpeltjänst gick att nå.',
  },
  'seal.stamp': {
    'en-GB': 'Loppa Sign · {envelope} · sealed {time} UTC · page {page} of {pages}',
    'sv-SE': 'Loppa Sign · {envelope} · förseglad {time} UTC · sida {page} av {pages}',
  },
  'seal.certificate': {
    'en-GB': 'Seal certificate SHA-256',
    'sv-SE': 'Förseglingscertifikatets SHA-256',
  },
  'seal.trail': {
    'en-GB': 'Trail SHA-256 (last event)',
    'sv-SE': 'Loggens SHA-256 (sista händelsen)',
  },
  'seal.events': { 'en-GB': 'Events', 'sv-SE': 'Händelser' },
  'seal.marks': { 'en-GB': 'Signatures', 'sv-SE': 'Underskrifter' },
  'seal.column.time': { 'en-GB': 'Time (UTC)', 'sv-SE': 'Tid (UTC)' },
  'seal.column.event': { 'en-GB': 'Event', 'sv-SE': 'Händelse' },
  'seal.column.party': { 'en-GB': 'Party', 'sv-SE': 'Part' },
  'seal.column.method': { 'en-GB': 'Method', 'sv-SE': 'Metod' },
  'seal.event.sent': { 'en-GB': 'Sent', 'sv-SE': 'Skickat' },
  'seal.event.viewed': { 'en-GB': 'Opened', 'sv-SE': 'Öppnat' },
  'seal.event.signed': { 'en-GB': 'Signed', 'sv-SE': 'Signerat' },
  'seal.event.declined': { 'en-GB': 'Declined', 'sv-SE': 'Avböjt' },
  'seal.event.expired': { 'en-GB': 'Expired', 'sv-SE': 'Löpte ut' },
  'seal.event.cancelled': { 'en-GB': 'Cancelled', 'sv-SE': 'Avbrutet' },
  'seal.method.typed': { 'en-GB': 'Typed name: {name}', 'sv-SE': 'Skrivet namn: {name}' },
  'seal.method.drawn': { 'en-GB': 'Drawn', 'sv-SE': 'Ritad' },
  'seal.method.console': { 'en-GB': 'Development provider', 'sv-SE': 'Utvecklingsleverantör' },
  'seal.method.eid': { 'en-GB': 'eID ({scheme})', 'sv-SE': 'e-legitimation ({scheme})' },
  'seal.watermark': { 'en-GB': 'TEST MODE', 'sv-SE': 'TESTLÄGE' },
};
