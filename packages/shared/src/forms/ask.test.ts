import { describe, expect, it } from 'vitest';
import { FORM_TEMPLATES } from './templates.js';
import { readAsk, TEMPLATE_KEYWORDS } from './ask.js';

const first = (text: string) => {
  const reading = readAsk(text, FORM_TEMPLATES);
  return reading.kind === 'template'
    ? reading.ids[0]
    : reading.kind === 'route'
      ? reading.route
      : null;
};

describe('readAsk', () => {
  it.each([
    ['PoA', 'power-of-attorney'],
    ['make a PoA', 'power-of-attorney'],
    ['power of attorney', 'power-of-attorney'],
    ['Vollmacht', 'power-of-attorney'],
    ['make a birthday party', 'rsvp'],
    ['kalas för Lisa', 'rsvp'],
    ['födelsedagsfest', 'rsvp'],
    ['wedding invitations', 'rsvp'],
    ['annual general meeting', 'general-meeting-registration'],
    ['sick leave', 'absence-notice'],
    ['jag vill ha en enkät', 'satisfaction-survey'],
    ['newsletter', 'newsletter-signup'],
    ['contract', 'sign'],
    ['skanna ett kvitto', 'scan'],
  ])('%s → %s', (text, expected) => {
    expect(first(text)).toBe(expected);
  });

  it('knows nothing of nonsense or an empty box', () => {
    expect(readAsk('', FORM_TEMPLATES).kind).toBe('none');
    expect(readAsk('zxqv', FORM_TEMPLATES).kind).toBe('none');
  });

  it('does not read a three-letter word inside another ("poacher")', () => {
    expect(first('poacher')).toBeNull();
  });

  it('offers at most three templates', () => {
    const reading = readAsk('event party registration course', FORM_TEMPLATES);
    expect(reading.kind === 'template' && reading.ids.length).toBeLessThanOrEqual(3);
  });

  it('only names templates that exist', () => {
    const ids = new Set(FORM_TEMPLATES.map((template) => template.id));
    for (const id of Object.keys(TEMPLATE_KEYWORDS)) expect(ids.has(id)).toBe(true);
    for (const id of ids) expect(TEMPLATE_KEYWORDS[id], id).toBeDefined();
  });
});
