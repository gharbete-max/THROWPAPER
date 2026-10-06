import { FormDefinition } from '../../forms/definition.js';
import { V, word } from '../../forms/vocabulary.js';

/**
 * The two recipes `CLAUDE.md` rule 8 keeps out of the template catalogue — a consent form and an
 * incident report (`docs/plan/BELIEF.md`, "Recipes"). The engine may recognise them, so nobody is
 * asked twenty questions to find out; but what "Right" adds is **structure and a bracketed
 * placeholder only**, the way the proxy template does (`forms/templates.ts`). The sentences that
 * make either one mean something are the organisation's to write (ADR 0012).
 *
 * The names are shown in the guess ("This looks like …"), never put in the form. What goes in the
 * form is held by `seed.test.ts` to the catalogue's regulated-word list, in every language.
 */

export interface Structure {
  readonly id: string;
  readonly name: Readonly<Record<string, string>>;
  readonly definition: FormDefinition;
}

const t = word;

const signatureLabel = t(
  'Signature',
  'Underskrift',
  'Underskrift',
  'Underskrift',
  'Allekirjoitus',
  'Undirskrift',
  'Signature',
  'Unterschrift',
  'Firma',
  '签名',
  '署名',
  'Подпись',
);

/** The same placeholder the catalogue's signatures carry: what it confirms is a person's to say. */
const signatureStatement = t(
  '[Replace with the declaration the signature confirms.]',
  '[Ersätt med den försäkran som underskriften bekräftar.]',
  '[Erstat med den erklæring, underskriften bekræfter.]',
  '[Erstatt med erklæringen underskriften bekrefter.]',
  '[Korvaa vakuutuksella, jonka allekirjoitus vahvistaa.]',
  '[Skiptu út fyrir yfirlýsinguna sem undirskriftin staðfestir.]',
  '[Remplacez par la déclaration que la signature confirme.]',
  '[Ersetzen Sie dies durch die Erklärung, die die Unterschrift bestätigt.]',
  '[Sustituye por la declaración que confirma la firma.]',
  '［请替换为签名所确认的声明。］',
  '［署名が確認する宣言文に置き換えてください。］',
  '[Замените заявлением, которое подтверждает подпись.]',
);

export const STRUCTURES: readonly Structure[] = [
  {
    id: 'consent-form',
    name: t(
      'Consent form',
      'Samtyckesblankett',
      'Samtykkeerklæring',
      'Samtykkeskjema',
      'Suostumuslomake',
      'Samþykkiseyðublað',
      'Formulaire de consentement',
      'Einwilligungsformular',
      'Formulario de consentimiento',
      '同意书',
      '同意書',
      'Форма согласия',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'wording',
          key: 'wording',
          type: 'rich_text',
          content: t(
            '[Replace this block with your own text. What people agree to here, and how they can take it back, is for your organisation to write; this product does not write it for you.]',
            '[Ersätt det här blocket med er egen text. Vad man godkänner här, och hur man kan ta tillbaka det, ska er organisation skriva – det skriver inte den här produkten åt er.]',
            '[Erstat denne blok med jeres egen tekst. Hvad man godkender her, og hvordan man kan trække det tilbage, skal jeres organisation skrive – det skriver dette produkt ikke for jer.]',
            '[Erstatt denne blokken med deres egen tekst. Hva man godtar her, og hvordan man kan trekke det tilbake, skal organisasjonen deres skrive – det skriver ikke dette produktet for dere.]',
            '[Korvaa tämä lohko omalla tekstillänne. Sen, mihin tässä suostutaan ja miten sen voi perua, kirjoittaa organisaationne – tämä tuote ei kirjoita sitä puolestanne.]',
            '[Skiptu þessum reit út fyrir ykkar eigin texta. Hvað fólk samþykkir hér og hvernig það getur dregið það til baka á ykkar félag að skrifa – þessi vara skrifar það ekki fyrir ykkur.]',
            '[Remplacez ce bloc par votre propre texte. Ce que l’on accepte ici, et comment on peut revenir dessus, c’est à votre organisation de l’écrire ; ce produit ne l’écrit pas à votre place.]',
            '[Ersetzen Sie diesen Block durch Ihren eigenen Text. Wozu man hier zustimmt und wie man es zurücknehmen kann, schreibt Ihre Organisation; dieses Produkt schreibt es nicht für Sie.]',
            '[Sustituye este bloque por vuestro propio texto. Lo que se acepta aquí, y cómo retirarlo, lo escribe vuestra organización; este producto no lo escribe por vosotros.]',
            '［请用你们自己的文字替换本段。人们在此同意什么、以及如何撤回，应由你们的组织撰写；本产品不会替你们写。］',
            '［このブロックは自組織の文章に置き換えてください。ここで何に同意し、どう取り消せるかは貴組織が書くものです。本製品が代わりに書くことはありません。］',
            '[Замените этот блок собственным текстом. На что здесь соглашаются и как это можно отозвать, пишет ваша организация; этот продукт не пишет это за вас.]',
          ),
        },
        { id: 'name', key: 'name', type: 'short_text', label: V.name, required: true },
        { id: 'date', key: 'date', type: 'date', label: V.date, required: true },
        {
          id: 'signature',
          key: 'signature',
          type: 'signature',
          label: signatureLabel,
          required: true,
          statement: signatureStatement,
        },
      ],
    }),
  },
  {
    id: 'incident-report',
    name: t(
      'Incident report',
      'Tillbudsrapport',
      'Hændelsesrapport',
      'Hendelsesrapport',
      'Vaaratilanneilmoitus',
      'Atvikaskýrsla',
      'Rapport d’incident',
      'Vorfallsmeldung',
      'Informe de incidente',
      '事件报告',
      'インシデント報告',
      'Отчёт об инциденте',
    ),
    definition: FormDefinition.parse({
      schemaVersion: 1,
      fields: [
        {
          id: 'wording',
          key: 'wording',
          type: 'rich_text',
          content: t(
            '[Replace this block with your own instructions. What to report, to whom, and what happens next is for your organisation to write; this product does not write it for you.]',
            '[Ersätt det här blocket med era egna instruktioner. Vad som ska rapporteras, till vem och vad som händer sedan ska er organisation skriva – det skriver inte den här produkten åt er.]',
            '[Erstat denne blok med jeres egne instruktioner. Hvad der skal rapporteres, til hvem, og hvad der sker bagefter, skal jeres organisation skrive – det skriver dette produkt ikke for jer.]',
            '[Erstatt denne blokken med deres egne instruksjoner. Hva som skal rapporteres, til hvem og hva som skjer etterpå, skal organisasjonen deres skrive – det skriver ikke dette produktet for dere.]',
            '[Korvaa tämä lohko omilla ohjeillanne. Sen, mitä ilmoitetaan, kenelle ja mitä sen jälkeen tapahtuu, kirjoittaa organisaationne – tämä tuote ei kirjoita sitä puolestanne.]',
            '[Skiptu þessum reit út fyrir ykkar eigin leiðbeiningar. Hvað á að tilkynna, til hvers og hvað gerist næst á ykkar félag að skrifa – þessi vara skrifar það ekki fyrir ykkur.]',
            '[Remplacez ce bloc par vos propres instructions. Ce qu’il faut signaler, à qui, et ce qui se passe ensuite, c’est à votre organisation de l’écrire ; ce produit ne l’écrit pas à votre place.]',
            '[Ersetzen Sie diesen Block durch Ihre eigenen Hinweise. Was gemeldet wird, an wen und was danach geschieht, schreibt Ihre Organisation; dieses Produkt schreibt es nicht für Sie.]',
            '[Sustituye este bloque por vuestras propias instrucciones. Qué hay que comunicar, a quién y qué ocurre después lo escribe vuestra organización; este producto no lo escribe por vosotros.]',
            '［请用你们自己的说明替换本段。报告什么、向谁报告、之后会怎样，应由你们的组织撰写；本产品不会替你们写。］',
            '［このブロックは自組織の案内に置き換えてください。何を、誰に報告し、その後どうなるかは貴組織が書くものです。本製品が代わりに書くことはありません。］',
            '[Замените этот блок собственными указаниями. О чём сообщать, кому и что происходит дальше, пишет ваша организация; этот продукт не пишет это за вас.]',
          ),
        },
        { id: 'name', key: 'name', type: 'short_text', label: V.name, required: true },
        { id: 'date', key: 'date', type: 'date', label: V.date, required: true },
        { id: 'time', key: 'time', type: 'time', label: V.time },
        { id: 'location', key: 'location', type: 'short_text', label: V.location },
        {
          id: 'what',
          key: 'what_happened',
          type: 'long_text',
          label: t(
            'What happened',
            'Vad hände',
            'Hvad skete der',
            'Hva skjedde',
            'Mitä tapahtui',
            'Hvað gerðist',
            'Ce qui s’est passé',
            'Was ist passiert',
            'Qué ocurrió',
            '发生了什么',
            '何が起きたか',
            'Что произошло',
          ),
          required: true,
        },
      ],
    }),
  },
];
