import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUOTED_CATEGORIES, QUOTED_LEXICON, mustQuote } from './quoted.js';

/**
 * Fixtures, in all twelve languages: one text that is a consent and must be quoted, and one
 * ordinary club notice that must not. They are test strings written to contain the lists' words;
 * none of them is wording any document may use.
 */
const CONSENT: Record<string, string> = {
  da: 'Samtykke til behandling af personoplysninger. Jeg giver samtykke og kan tilbagekalde det.',
  de: 'Einwilligung: Ich willige ein, dass meine personenbezogenen Daten verarbeitet werden. Ich kann die Einwilligung widerrufen.',
  en: 'Consent: I consent to my personal data being processed, and I can withdraw my consent.',
  es: 'Consentimiento: doy mi consentimiento al tratamiento de mis datos personales y puedo revocarlo.',
  fi: 'Suostumus henkilötietojen käsittelyyn. Suostun siihen ja voin peruuttaa suostumukseni.',
  fr: 'Consentement : je consens au traitement de mes données personnelles et je peux retirer mon consentement.',
  is: 'Samþykki: Ég samþykki að persónuupplýsingar mínar séu meðhöndlaðar og get afturkallað samþykkið.',
  ja: '個人情報の取り扱いに同意します。同意はいつでも撤回できます。',
  nb: 'Samtykke: Jeg samtykker til behandling av personopplysninger og kan trekke tilbake samtykket.',
  ru: 'Согласие на обработку персональных данных. Я согласен и могу отозвать согласие.',
  sv: 'Samtycke: Jag samtycker till behandling av mina personuppgifter och kan återkalla mitt samtycke.',
  zh: '个人信息处理同意书：我同意处理我的个人信息，并可随时撤回。',
};

const NOTICE: Record<string, string> = {
  da: 'Kære medlemmer. Havefesten holdes lørdag den 18. april klokken 14. Husk at medbringe kage og stole.',
  de: 'Liebe Mitglieder, das Sommerfest findet am Samstag, den 18. April um 14 Uhr statt. Bitte bringt Kuchen mit.',
  en: 'Dear members, the summer party is on Saturday 18 April at 14:00. Please bring cake and chairs.',
  es: 'Queridos socios, la fiesta de verano es el sábado 18 de abril a las 14:00. Traed tarta y sillas.',
  fi: 'Hyvät jäsenet, kesäjuhla pidetään lauantaina 18. huhtikuuta kello 14. Tuokaa kakkua ja tuoleja.',
  fr: "Chers membres, la fête d'été a lieu samedi 18 avril à 14 h. Apportez un gâteau et des chaises.",
  is: 'Kæru félagar, sumarhátíðin er laugardaginn 18. apríl klukkan 14. Takið með köku og stóla.',
  ja: '会員の皆様、夏祭りは4月18日の土曜日午後2時からです。ケーキと椅子をお持ちください。',
  nb: 'Kjære medlemmer, sommerfesten er lørdag 18. april klokken 14. Ta med kake og stoler.',
  ru: 'Уважаемые члены клуба, летний праздник состоится в субботу, 18 апреля, в 14:00. Приносите пироги и стулья.',
  sv: 'Kära medlemmar, sommarfesten är lördag den 18 april klockan 14. Ta med tårta och stolar.',
  zh: '各位会员，夏季聚会定于4月18日星期六下午两点举行，请带蛋糕和椅子。',
};

describe('which texts are quoted and never reworded', () => {
  it.each(Object.keys(CONSENT))('%s: a consent is quoted', (code) => {
    const verdict = mustQuote(CONSENT[code]!);
    expect(verdict.categories, JSON.stringify(verdict.terms)).toContain('consent');
    expect(verdict.quoteOnly).toBe(true);
  });

  it.each(Object.keys(NOTICE))('%s: an ordinary notice is not', (code) => {
    const verdict = mustQuote(NOTICE[code]!);
    expect(verdict.quoteOnly, JSON.stringify(verdict.terms)).toBe(false);
  });

  it('finds a contract, a declaration and a clinical form by their own words', () => {
    expect(
      mustQuote('This agreement binds the parties. Liability and termination follow.').categories,
    ).toContain('contract');
    expect(
      mustQuote('I hereby certify, to the best of my knowledge, that this is true and correct.')
        .categories,
    ).toContain('declaration');
    expect(
      mustQuote('Patient name. Diagnosis. Current medication and dosage.').categories,
    ).toContain('clinical');
  });

  it('needs two different terms: one word is a choir, not a form', () => {
    expect(mustQuote('The patient choir sings on Saturday.').quoteOnly).toBe(false);
    expect(mustQuote('Patient, patients and patients: patient.').quoteOnly).toBe(false);
    expect(mustQuote('The patient choir sings; bring your medication.').quoteOnly).toBe(true);
  });

  it('matches whole words, so a word inside another word does not count', () => {
    expect(mustQuote('Impatient diagnosticians.').quoteOnly).toBe(false);
  });

  it('works through case and typographic apostrophes', () => {
    expect(mustQuote('JE CONSENS. Données Personnelles.').categories).toContain('consent');
    expect(mustQuote('Je certifie sur l’honneur que.').categories).toContain('declaration');
  });

  it('says what it found, for a reviewer', () => {
    expect(mustQuote(CONSENT.en!).terms.consent).toEqual(
      expect.arrayContaining(['consent', 'personal data']),
    );
  });
});

describe('the word lists', () => {
  it('cover every category in all twelve languages', () => {
    for (const category of QUOTED_CATEGORIES) {
      const languages = Object.keys(QUOTED_LEXICON.categories[category] ?? {}).sort();
      expect(languages, category).toEqual(
        ['da', 'de', 'en', 'es', 'fi', 'fr', 'is', 'ja', 'nb', 'ru', 'sv', 'zh'].sort(),
      );
      for (const terms of Object.values(QUOTED_LEXICON.categories[category] ?? {})) {
        expect(terms.length).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('are lower-case and sorted, in the file ADR 0021 describes', () => {
    for (const category of Object.values(QUOTED_LEXICON.categories)) {
      for (const terms of Object.values(category ?? {})) {
        expect(terms).toEqual([...terms].sort());
        for (const term of terms) expect(term).toBe(term.toLowerCase());
      }
    }
    const parsed = JSON.parse(
      readFileSync(new URL('./lexicon.json', import.meta.url), 'utf8'),
    ) as object;
    expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort());
  });
});
