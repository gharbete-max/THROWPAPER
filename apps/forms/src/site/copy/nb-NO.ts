import type { SiteCopy } from '../content.js';

/**
 * Norwegian Bokmål.
 *
 * Bokmål specifically, which is what `nb-NO` means — not "Norwegian" as a vague average of the two
 * written standards. Where bokmål allows both a Danish-looking and a more Norwegian form, the
 * everyday one is used: "skjema" not "formular", "påmelding" not "tilmelding".
 *
 * Translated from the English rather than adapted from the Danish, for the reason the Danish file
 * gives in reverse: the two are close enough that adapting produces Danish grammar wearing
 * Norwegian spelling, which every Norwegian reader notices immediately.
 */
export const nbNO: SiteCopy = {
  meta: {
    homeTitle: 'Formwork — skjemaer, påmeldinger og døra',
    homeDescription:
      'Et skjemaverktøy for organisasjoner som må få det riktig: tolv språk, deres egen profil overalt, og et adgangskort som kan skannes i døra.',
    titleSuffix: ' — Formwork',
  },
  chrome: {
    skipToContent: 'Hopp til innholdet',
    siteNavLabel: 'Nettsted',
    policiesNavLabel: 'Vilkår',
    languageLabel: 'Språk',
    openTheDemo: 'Åpne demoen',
    footerTagline:
      'Formwork. Skjemaer, påmeldinger og døra. Demoen lagrer ingenting og sender ingenting.',
  },
  hero: {
    eyebrow: 'Skjemaer, påmeldinger og døra',
    title: 'Spør folk skikkelig.',
    body: 'Tolv språk, deres egen profil overalt, og et adgangskort som kan skannes i døra.',
    secondary: 'Se hva det gjør',
  },
  sections: {
    featuresEyebrow: 'Alt det gjør',
    featuresTitle: 'Bygd for dagen det brukes',
    readMore: 'Les mer',
    quotesEyebrow: 'I bruk',
    quotesTitle: 'Hva folk sa etterpå',
    ctaTitle: 'Ingenting å installere',
    ctaBody:
      'Demoen kjører på oppdiktede data, sender ingen e-post og glemmer alt når den startes på nytt.',
  },
  featurePage: {
    backToAll: 'Alt det gjør',
    back: 'Tilbake',
    otherFeatures: 'Andre funksjoner',
  },
  features: {
    forms: {
      name: 'Skjemabyggeren',
      summary:
        'Sytten felttyper, betingelser som faktisk forgreiner seg, og en forhåndsvisning som er skjemaet.',
      intro:
        'Dra inn et felt, skriv spørsmålet, se det. Forhåndsvisningen ved siden av flata er den samme rendereren som respondenten får, ikke en tilnærming til den — det du ser på mens du bygger, er det de skal fylle ut.',
      points: [
        {
          heading: 'Sytten slags spørsmål',
          body: 'Tekst, tall, datoer og klokkeslett, ett eller flere valg, vurderinger, filer, signaturer. Så pynt: figurer og frihåndstegning som ikke samler inn noe og aldri dukker opp i eksporten.',
        },
        {
          heading: 'Betingelser som ikke kan gå i ring',
          body: 'Et spørsmål kan avhenge av et svar over seg, og bare over seg. Framoverreferanser avvises, og det er dét som gjør en sykel umulig ved konstruksjonen framfor ved en kontroll som kjører for sent.',
        },
        {
          heading: 'Tjuetre maler',
          body: 'Arrangementer, tjenester, utdanning, handel, medlemskap, arbeidsplass, styring og forskning — hver av dem komplett på alle tolv språkene. En mal som kopierer engelsk inn i et finsk skjema, er ikke et utgangspunkt.',
        },
      ],
    },
    events: {
      name: 'Arrangementer og døra',
      summary:
        'Påmelding, et adgangskort folk kan skrive ut, og en innsjekkingsskjerm for inngangen.',
      intro:
        'Et arrangement er et skjema med en dato, et tak og ei dør. Alt etter påmeldingen — fra bekreftelsen til personen som skanner et kort i inngangen — er den delen som pleier å bli improvisert. Derfor er den bygd inn.',
      points: [
        {
          heading: 'Et adgangskort som kan skannes',
          body: 'En PDF med opplysningene om arrangementet og en QR-kode som bærer et signert token. Fire moduler stille sone og feilretting på det nivået trykte koder krever, slik at en brett tvers gjennom symbolet fortsatt leses i ei dør i desember.',
        },
        {
          heading: 'En skjerm for inngangen',
          body: 'Stor skrift, et stort innskrivingsfelt og en avgjørelse som kan leses på en armlengdes avstand. Bygd for å holdes i én hånd i ei dør på lokalets dårlige wifi.',
        },
        {
          heading: 'Et tak som betyr noe',
          body: 'Et fullt arrangement stenger seg selv. En venteliste er en avgjørelse dere tar, ikke en tilstand dere oppdager.',
        },
      ],
    },
    responses: {
      name: 'Svar',
      summary: 'Alt som kommer inn, på ett sted, eksporterbart uten å miste hva tallene betydde.',
      intro:
        'Svarene lander i en innboks og et rutenett. Rutenettet sorterer på verdien framfor på teksten du ser, så en tallkolonne sorteres numerisk og en kolonne med norske navn sorteres slik norsk sorterer.',
      points: [
        {
          heading: 'Eksport som overlever et regneark',
          body: 'En CSV-kolonne per besvarbart felt, navngitt etter feltnøkkelen. Pynt er ingen kolonne; en figur du har tegnet, endrer ingenting i fila.',
        },
        {
          heading: 'Sortering som kan språket',
          body: 'ICU-kollasjon, så æ ø å sorteres slik norsk og dansk forventer, og å ä ö kommer etter z på svensk. Ikke en byte-sammenlikning med et språknavn på seg.',
        },
        {
          heading: 'Ingenting sendes uten en bekreftelse',
          body: 'Hver utgående handling har en testmodus og et steg som spør. En e-post til fire hundre personer bør kreve to bevisste klikk.',
        },
      ],
    },
    brand: {
      name: 'Fargene deres, overalt',
      summary:
        'Én palett kompilert til appen, e-posten, PDF-en og et mørkt tema ingen måtte tegne.',
      intro:
        'En profil her er ikke et stilark med logoen deres i. Det er ett sett med tokens kompilert til fire mål, slik at skjemaet på skjermen, bekreftelsesmeldingen, det utskrevne adgangskortet og en framtidig app er den samme merkevaren framfor fire tilnærminger til den.',
      points: [
        {
          heading: 'Et mørkt tema dere ikke lagde',
          body: 'Den mørke paletten utledes av den lyse og beholder kuløren til hver farge framfor å dra den mot grått. Enhver organisasjon har et mørkt tema den dagen det lanseres — også de som valgte fargene sine for et år siden.',
        },
        {
          heading: 'Kontrast sjekkes mens dere velger',
          body: 'Advarselen dukker opp mens dere velger en farge, ikke etter at dere har lagret. En advarsel som kommer etter at man har bestemt seg, er en irettesettelse framfor hjelp.',
        },
        {
          heading: 'Skalaer ut fra ett tall',
          body: 'Angi én radius og få en familie; én tekststørrelse og et forhold og få en skala. Ingenting å holde i takt, og ingenting nytt å forstå.',
        },
      ],
    },
    languages: {
      name: 'Tolv språk',
      summary: 'Grensesnittet, malene, e-postene og det utskrevne kortet — ikke bare knappene.',
      intro:
        'Engelsk, svensk, dansk, norsk, finsk, islandsk, fransk, tysk, spansk, kinesisk, japansk og russisk. Grensesnittet er ett språk om gangen og det er en personlig innstilling; et skjema er et dokument og kan tilby sin egen velger.',
      points: [
        {
          heading: 'Også det som kommer etterpå',
          body: 'Bekreftelsesmeldingen og adgangskortet skrives på språket skjemaet ble fylt ut på, og sier det i sin egen oppmerking, slik at en skjermleser leser en japansk e-post på japansk.',
        },
        {
          heading: 'Publisering stanses av en manglende oversettelse',
          body: 'Et skjema som hevder to språk og har ett, er ikke klart. Fullstendighetssjekken er den samme koden i redigeringsvinduet som i endepunktet, så de kan ikke være uenige med hverandre.',
        },
        {
          heading: 'Flertallsformer og kollasjon, ikke strengsammensetning',
          body: 'Antall leses riktig på språk med flere enn to flertallsformer, og lister sorteres etter reglene til språket framfor etter tegnkode.',
        },
      ],
    },
    ledger: {
      name: 'En regnskapsbok som ikke kan endres',
      summary: 'Dobbelt bokføring, bare tillegg. En feil motposteres, aldri stilltiende omskrevet.',
      intro:
        'Avgifter, depositum og refusjoner ført ordentlig. Det finnes verken oppdatering eller sletting noe sted i den: en feil postering rettes med en motpostering som bytter side, slik at både originalen og rettelsen blir stående.',
      points: [
        {
          heading: 'Eksakt aritmetikk',
          body: 'Beløp er bigint i minste valutaenhet, aldri flyttall. Et øre som ikke finnes, er ingen avrundingsstil, det er en feil med lang hale.',
        },
        {
          heading: 'Alle feil på én gang',
          body: 'En postering som ikke balanserer, rapporterer alle problemene sine framfor det første, slik at det å rette en postering er én runde framfor fire.',
        },
        {
          heading: 'Motpostering, ikke sletting',
          body: 'Dét som gjør en regnskapsbok til en regnskapsbok. Å streke over noe og signere i margen er papirutgaven av den samme regelen.',
        },
      ],
    },
  },
  quotes: [
    {
      text: 'Adgangskortene ble skannet på første forsøk, i regnvær, med kø. Det var hele testen.',
      who: 'Arrangementsansvarlig, ordinært årsmøte',
    },
    {
      text: 'Vi publiserer på norsk og engelsk. Det nekter å la meg publisere halvparten av det ene, noe som har reddet meg to ganger.',
      who: 'Medlemssekretær',
    },
    {
      text: 'Jeg endret én farge, og e-postene endret seg med. Jeg hadde regnet med at det ville bli en supportsak.',
      who: 'Kommunikasjonsansvarlig',
    },
  ],
};
