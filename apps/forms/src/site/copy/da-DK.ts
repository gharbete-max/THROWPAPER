import type { SiteCopy } from '../content.js';

/**
 * Danish.
 *
 * Close enough to the Swedish that the temptation is to copy it and change the spelling, and that
 * is exactly how a Danish reader ends up with Swedish grammar. Translated from the English.
 *
 * "Formular", not "blanket" — a blanket is what an authority sends you. "Tilmelding" for the act
 * of registering, which is what an association calls it, rather than "registrering", which is what
 * a database calls it.
 */
export const daDK: SiteCopy = {
  meta: {
    homeTitle: 'Paloppa — formularer, tilmeldinger og døren',
    homeDescription:
      'Et formularværktøj til organisationer, der skal have det til at passe: tolv sprog, jeres eget design overalt, og et adgangskort, der kan scannes i døren.',
    titleSuffix: ' — Paloppa',
  },
  chrome: {
    skipToContent: 'Spring til indhold',
    siteNavLabel: 'Websted',
    policiesNavLabel: 'Betingelser',
    languageLabel: 'Sprog',
    openTheDemo: 'Åbn demoen',
    footerTagline:
      'Paloppa. Formularer, tilmeldinger og døren. Demoen gemmer intet og sender intet.',
  },
  hero: {
    eyebrow: 'Formularer, tilmeldinger og døren',
    title: 'Spørg folk ordentligt.',
    body: 'Tolv sprog, jeres eget design overalt, og et adgangskort, der kan scannes i døren.',
    secondary: 'Se hvad det kan',
    pause: 'Sæt animationen på pause',
    play: 'Afspil animationen',
  },
  sections: {
    featuresEyebrow: 'Alt hvad det gør',
    featuresTitle: 'Bygget til den dag det bruges',
    readMore: 'Læs mere',
    quotesEyebrow: 'I brug',
    quotesTitle: 'Hvad folk sagde bagefter',
    ctaTitle: 'Intet at installere',
    ctaBody:
      'Demoen kører på opdigtede data, sender ingen e-mail og glemmer alt, når den genstartes.',
  },
  featurePage: {
    backToAll: 'Alt hvad det gør',
    back: 'Tilbage',
    otherFeatures: 'Andre funktioner',
  },
  notFound: {
    title: 'Der er ingen side her',
    body: 'Linket kan være gammelt eller stavet forkert. Alt hvad produktet gør, er listet nedenfor, og forsiden er ét tryk væk.',
  },
  contact: {
    link: 'Skriv til os',
    title: 'Skriv til os',
    lede: 'Fortæl hvem du er, og hvad I driver. Et menneske læser det og svarer inden for en dag eller to.',
    name: 'Dit navn',
    organisation: 'Organisation (valgfrit)',
    email: 'E-mail',
    message: 'Hvad vil du spørge om?',
    send: 'Send',
    sentTitle: 'Sendt. Tak.',
    sentBody: 'Vi svarer til den adresse, du angav, som regel inden for to arbejdsdage.',
  },
  features: {
    forms: {
      name: 'Formularbyggeren',
      summary:
        'Sytten felttyper, betingelser der rent faktisk forgrener sig, og en forhåndsvisning der er formularen.',
      intro:
        'Træk et felt ind, skriv spørgsmålet, se det. Forhåndsvisningen ved siden af fladen er den samme renderer, som respondenten får, ikke en tilnærmelse af den — det, du ser på, mens du bygger, er det, de skal udfylde.',
      points: [
        {
          heading: 'Sytten slags spørgsmål',
          body: 'Tekst, tal, datoer og klokkeslæt, enkelt- og flervalg, bedømmelser, filer, underskrifter. Dertil pynt: figurer og frihåndstegning, der ikke indsamler noget og aldrig optræder i eksporten.',
        },
        {
          heading: 'Betingelser der ikke kan gå i ring',
          body: 'Et spørgsmål må afhænge af et svar over sig, og kun over sig. Fremadrettede henvisninger afvises, og det er dét, der gør en cyklus umulig ved konstruktionen frem for ved en kontrol, der kører for sent.',
        },
        {
          heading: 'Treogtyve skabeloner',
          body: 'Arrangementer, tjenester, uddannelse, detail, medlemskab, arbejdsplads, ledelse og forskning — hver især komplet på alle tolv sprog. En skabelon, der kopierer engelsk ind i en finsk formular, er ikke et udgangspunkt.',
        },
      ],
    },
    events: {
      name: 'Arrangementer og døren',
      summary: 'Tilmelding, et adgangskort folk kan printe, og en indtjekningsskærm til indgangen.',
      intro:
        'Et arrangement er en formular med en dato, et loft og en dør. Alt efter tilmeldingen — fra bekræftelsen til personen, der scanner et kort i indgangen — er den del, der plejer at blive improviseret. Derfor er den bygget ind.',
      points: [
        {
          heading: 'Et adgangskort der kan scannes',
          body: 'En PDF med arrangementets oplysninger og en QR-kode, der bærer et signeret token. Fire moduler stille zone og fejlkorrektion på det niveau, trykte koder kræver, så et knæk tværs gennem symbolet stadig kan læses i en dør i december.',
        },
        {
          heading: 'En skærm til indgangen',
          body: 'Stor skrift, et stort indtastningsfelt og en afgørelse, der kan læses på en armslængdes afstand. Bygget til at holdes i én hånd i en dør på stedets dårlige wifi.',
        },
        {
          heading: 'Et loft der betyder noget',
          body: 'Et fuldt arrangement lukker sig selv. En venteliste er en beslutning, I træffer, ikke en tilstand, I opdager.',
        },
      ],
    },
    responses: {
      name: 'Svar',
      summary: 'Alt hvad der kommer ind, ét sted, eksporterbart uden at miste hvad tallene betød.',
      intro:
        'Svarene lander i en indbakke og et gitter. Gitteret sorterer på værdien frem for på den tekst, du ser, så en talkolonne sorteres numerisk, og en kolonne med danske navne sorteres, som dansk sorterer.',
      points: [
        {
          heading: 'Eksport der overlever et regneark',
          body: 'En CSV-kolonne pr. besvarbart felt, navngivet efter feltnøglen. Pynt er ikke en kolonne; en figur, du har tegnet, ændrer intet i filen.',
        },
        {
          heading: 'Sortering der kender sproget',
          body: 'ICU-kollation, så æ ø å sorteres, som dansk og norsk forventer, og å ä ö kommer efter z på svensk. Ikke en byte-sammenligning med et sprognavn på.',
        },
        {
          heading: 'Intet sendes uden en bekræftelse',
          body: 'Hver udgående handling har en testtilstand og et trin, der spørger. En e-mail til fire hundrede mennesker bør kræve to bevidste klik.',
        },
      ],
    },
    brand: {
      name: 'Jeres farver, overalt',
      summary:
        'Én palet kompileret til appen, e-mailen, PDF’en og en mørk tilstand, ingen skulle tegne.',
      intro:
        'Et designsæt her er ikke et stylesheet med jeres logo i. Det er ét sæt tokens kompileret til fire mål, så formularen på skærmen, bekræftelsesmailen, det printede adgangskort og en fremtidig app er det samme brand frem for fire tilnærmelser af det.',
      points: [
        {
          heading: 'En mørk tilstand I ikke har lavet',
          body: 'Den mørke palet udledes af den lyse og bevarer hver farves kulør frem for at trække den mod grå. Enhver organisation har et mørkt tema den dag, det udkommer — også dem, der valgte deres farver for et år siden.',
        },
        {
          heading: 'Kontrast kontrolleres mens I vælger',
          body: 'Advarslen dukker op, mens I vælger en farve, ikke efter I har gemt. En advarsel, der kommer, efter man har besluttet sig, er en irettesættelse frem for hjælp.',
        },
        {
          heading: 'Skalaer ud fra ét tal',
          body: 'Angiv én radius og få en familie; én tekststørrelse og et forhold og få en skala. Intet at holde i takt, og intet nyt at forstå.',
        },
      ],
    },
    languages: {
      name: 'Tolv sprog',
      summary: 'Grænsefladen, skabelonerne, e-mailene og det printede kort — ikke bare knapperne.',
      intro:
        'Engelsk, svensk, dansk, norsk, finsk, islandsk, fransk, tysk, spansk, kinesisk, japansk og russisk. Grænsefladen er ét sprog ad gangen, og det er en personlig indstilling; en formular er et dokument og kan tilbyde sin egen vælger.',
      points: [
        {
          heading: 'Også det der kommer bagefter',
          body: 'Bekræftelsesmailen og adgangskortet skrives på det sprog, formularen blev udfyldt på, og siger det i deres egen opmærkning, så en skærmlæser læser en japansk e-mail på japansk.',
        },
        {
          heading: 'Udgivelse blokeres af en manglende oversættelse',
          body: 'En formular, der påstår to sprog og har ét, er ikke klar. Fuldstændighedstjekket er den samme kode i editoren som i endepunktet, så de kan ikke være uenige med hinanden.',
        },
        {
          heading: 'Flertalsformer og kollation, ikke strengsammensætning',
          body: 'Antal læses rigtigt på sprog med mere end to flertalsformer, og lister sorteres efter sprogets regler frem for efter tegnkode.',
        },
      ],
    },
    ledger: {
      name: 'Et regnskab der ikke kan rettes',
      summary:
        'Dobbelt bogholderi, kun tilføjelser. En fejl modposteres, aldrig stiltiende omskrevet.',
      intro:
        'Gebyrer, depositum og refusioner bogført ordentligt. Der findes hverken opdatering eller sletning nogen steder i det: en forkert postering rettes med en modpostering, der bytter side, så både originalen og rettelsen står tilbage.',
      points: [
        {
          heading: 'Eksakt aritmetik',
          body: 'Beløb er bigint i mindste valutaenhed, aldrig kommatal. En øre, der ikke findes, er ikke en afrundingsstil, det er en fejl med lang hale.',
        },
        {
          heading: 'Alle fejl på én gang',
          body: 'En postering, der ikke balancerer, rapporterer alle sine problemer frem for det første, så det at rette en postering er én omgang frem for fire.',
        },
        {
          heading: 'Modpostering, ikke sletning',
          body: 'Dét, der gør et regnskab til et regnskab. At strege noget ud og signere i marginen er papirudgaven af den samme regel.',
        },
      ],
    },
  },
  quotes: [
    {
      text: 'Adgangskortene blev scannet i første forsøg, i regnvejr, med kø. Det var hele testen.',
      who: 'Arrangementsansvarlig, ordinær generalforsamling',
    },
    {
      text: 'Vi udgiver på dansk og engelsk. Det nægter at lade mig udgive halvdelen af det ene, hvilket har reddet mig to gange.',
      who: 'Medlemssekretær',
    },
    {
      text: 'Jeg ændrede én farve, og e-mailene ændrede sig med. Jeg havde regnet med, at det ville blive en supportsag.',
      who: 'Kommunikationsansvarlig',
    },
  ],
};
