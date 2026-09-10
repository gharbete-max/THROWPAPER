import type { SiteCopy } from '../content.js';

/**
 * Swedish.
 *
 * Translated rather than transposed. The English is plain, dry and confident, and a literal
 * rendering of it reads as translated English — so idiom wins over word order where the two
 * disagree. Two decisions worth recording, because a later reviewer will otherwise "fix" them:
 *
 * - **"Formulär", not "blankett".** A blankett is a paper form from an authority; this product is
 *   used by associations and organisers, and formulär is what they call the thing they build.
 * - **"Du"-tilltal throughout.** Swedish business writing dropped the formal address decades ago,
 *   and "ni" to a single reader now reads as either archaic or as a shop assistant.
 */
export const svSE: SiteCopy = {
  meta: {
    homeTitle: 'Formwork — formulär, anmälningar och entrén',
    homeDescription:
      'Ett formulärverktyg för organisationer som måste få det rätt: tolv språk, er egen grafiska profil överallt och ett inträdeskort som fungerar i entrén.',
    titleSuffix: ' — Formwork',
  },
  chrome: {
    skipToContent: 'Hoppa till innehållet',
    siteNavLabel: 'Webbplats',
    policiesNavLabel: 'Villkor',
    languageLabel: 'Språk',
    openTheDemo: 'Öppna demon',
    footerTagline:
      'Formwork. Formulär, anmälningar och entrén. Demon sparar ingenting och skickar ingenting.',
  },
  hero: {
    eyebrow: 'Formulär, anmälningar och entrén',
    title: 'Fråga folk ordentligt.',
    body: 'Tolv språk, er egen grafiska profil överallt och ett inträdeskort som fungerar i entrén.',
    secondary: 'Se vad det gör',
  },
  sections: {
    featuresEyebrow: 'Allt det gör',
    featuresTitle: 'Byggt för dagen det används',
    readMore: 'Läs mer',
    quotesEyebrow: 'I bruk',
    quotesTitle: 'Vad folk sa efteråt',
    ctaTitle: 'Inget att installera',
    ctaBody:
      'Demon körs på påhittade uppgifter, skickar ingen e-post och glömmer allt när den startas om.',
  },
  featurePage: {
    backToAll: 'Allt det gör',
    back: 'Tillbaka',
    otherFeatures: 'Andra funktioner',
  },
  features: {
    forms: {
      name: 'Formulärbyggaren',
      summary:
        'Sjutton fälttyper, villkor som faktiskt förgrenar sig, och en förhandsvisning som är formuläret.',
      intro:
        'Dra in ett fält, skriv frågan, se den. Förhandsvisningen bredvid ytan är samma renderare som den svarande får, inte en approximation av den — det du tittar på medan du bygger är det de kommer att fylla i.',
      points: [
        {
          heading: 'Sjutton sorters frågor',
          body: 'Text, tal, datum och tider, ett eller flera val, betyg, filer, underskrifter. Sedan dekor: figurer och frihandsteckning som inte samlar in något och aldrig dyker upp i exporten.',
        },
        {
          heading: 'Villkor som inte kan gå i cirkel',
          body: 'En fråga får bero på ett svar ovanför sig, och bara ovanför sig. Framåtreferenser avvisas, och det är det som gör en cykel omöjlig genom konstruktionen i stället för genom en kontroll som körs för sent.',
        },
        {
          heading: 'Tjugotre mallar',
          body: 'Evenemang, tjänster, utbildning, handel, medlemskap, arbetsplats, styrning och forskning — var och en komplett på alla tolv språken. En mall som kopierar in engelska i ett finskt formulär är ingen utgångspunkt.',
        },
      ],
    },
    events: {
      name: 'Evenemang och entrén',
      summary: 'Anmälan, ett inträdeskort som går att skriva ut, och en incheckningsvy för entrén.',
      intro:
        'Ett evenemang är ett formulär med ett datum, ett tak och en entré. Allt efter anmälan — från bekräftelsen till personen som skannar ett kort i dörren — är den del som brukar improviseras fram. Därför är den inbyggd.',
      points: [
        {
          heading: 'Ett inträdeskort som går att skanna',
          body: 'En PDF med uppgifterna om evenemanget och en QR-kod som bär en signerad token. Fyra moduler tyst zon och felkorrigering på den nivå tryckta koder kräver, så att ett veck tvärs över symbolen fortfarande läses av i en entré i december.',
        },
        {
          heading: 'En vy för entrén',
          body: 'Stor text, ett stort inmatningsfält och ett besked som går att läsa på armlängds avstånd. Byggd för att hållas i en hand i en dörr på lokalens dåliga wifi.',
        },
        {
          heading: 'Ett tak som betyder något',
          body: 'Ett fullt evenemang stänger sig självt. En väntelista är ett beslut du fattar, inte ett tillstånd du upptäcker.',
        },
      ],
    },
    responses: {
      name: 'Svar',
      summary:
        'Allt som kommer in, på ett ställe, exporterbart utan att tappa vad siffrorna betydde.',
      intro:
        'Svaren landar i en inkorg och en tabell. Tabellen sorterar på värdet i stället för på texten du ser, så en numerisk kolumn sorteras numeriskt och en kolumn med svenska namn sorteras som svenska sorteras.',
      points: [
        {
          heading: 'Export som överlever ett kalkylark',
          body: 'En CSV-kolumn per besvarbart fält, namngiven efter fältnyckeln. Dekor är ingen kolumn; en figur du ritat ändrar ingenting i filen.',
        },
        {
          heading: 'Sortering som kan språket',
          body: 'ICU-kollation, så att å ä ö kommer efter z på svenska och æ ø å sorteras som danska och norska förväntar sig. Inte en bytejämförelse med ett språknamn på sig.',
        },
        {
          heading: 'Ingenting skickas utan en bekräftelse',
          body: 'Varje utgående åtgärd har ett testläge och ett steg som frågar. Ett utskick till fyrahundra personer ska kräva två medvetna klick.',
        },
      ],
    },
    brand: {
      name: 'Era färger, överallt',
      summary:
        'En palett kompilerad till appen, e-posten, PDF:en och ett mörkt läge ingen behövde rita.',
      intro:
        'En grafisk profil här är inte ett stilmall med er logotyp i. Det är en uppsättning tokens kompilerad till fyra mål, så att formuläret på skärmen, bekräftelsemejlet, det utskrivna inträdeskortet och en framtida app är samma varumärke i stället för fyra approximationer av det.',
      points: [
        {
          heading: 'Ett mörkt läge ni inte behövde göra',
          body: 'Den mörka paletten härleds ur den ljusa och behåller varje färgs kulör i stället för att dra den mot grått. Varje organisation har ett mörkt tema den dag det lanseras, även de som valde sina färger för ett år sedan.',
        },
        {
          heading: 'Kontrast kontrolleras medan ni väljer',
          body: 'Varningen dyker upp när ni väljer en färg, inte efter att ni sparat. En varning som kommer efter att man bestämt sig är en tillrättavisning snarare än hjälp.',
        },
        {
          heading: 'Skalor ur ett enda tal',
          body: 'Ange en radie och få en familj; en textstorlek och ett förhållande och få en skala. Ingenting att hålla i takt, och ingenting nytt att förstå.',
        },
      ],
    },
    languages: {
      name: 'Tolv språk',
      summary: 'Gränssnittet, mallarna, mejlen och det utskrivna kortet — inte bara knapparna.',
      intro:
        'Engelska, svenska, danska, norska, finska, isländska, franska, tyska, spanska, kinesiska, japanska och ryska. Gränssnittet är ett språk i taget och det är en personlig inställning; ett formulär är ett dokument och kan erbjuda sin egen växlare.',
      points: [
        {
          heading: 'Även det som kommer efteråt',
          body: 'Bekräftelsemejlet och inträdeskortet skrivs på det språk formuläret fylldes i på, och säger det i sin egen uppmärkning, så att en skärmläsare läser ett japanskt mejl på japanska.',
        },
        {
          heading: 'Publicering stoppas av en saknad översättning',
          body: 'Ett formulär som utger sig för att finnas på två språk och bara finns på ett är inte klart. Fullständighetskontrollen är samma kod i redigeraren som i slutpunkten, så de kan inte säga emot varandra.',
        },
        {
          heading: 'Pluralformer och kollation, inte strängkonkatenering',
          body: 'Antal läses rätt på språk med fler än två pluralformer, och listor sorteras efter språkets regler i stället för efter teckenkod.',
        },
      ],
    },
    ledger: {
      name: 'En liggare som inte går att ändra',
      summary:
        'Dubbel bokföring, endast tillägg. Ett fel rättas med en motpostering, aldrig genom en tyst omskrivning.',
      intro:
        'Avgifter, depositioner och återbetalningar bokförda ordentligt. Det finns varken uppdatering eller radering någonstans i den: en felaktig post rättas med en motpostering som byter sida, så att både originalet och rättelsen står kvar.',
      points: [
        {
          heading: 'Exakt aritmetik',
          body: 'Belopp är bigint i minsta valutaenhet, aldrig flyttal. Ett öre som inte finns är ingen avrundningsstil, det är en bugg med lång svans.',
        },
        {
          heading: 'Alla fel på en gång',
          body: 'En postering som inte balanserar rapporterar alla sina problem i stället för det första, så att rätta en post är en genomgång i stället för fyra.',
        },
        {
          heading: 'Motpostering, inte radering',
          body: 'Det som gör en liggare till en liggare. Att stryka över något och signera i marginalen är pappersversionen av samma regel.',
        },
      ],
    },
  },
  quotes: [
    {
      text: 'Inträdeskorten lästes av på första försöket, i regn, med kö. Det var hela testet.',
      who: 'Evenemangsansvarig, vårstämma',
    },
    {
      text: 'Vi publicerar på svenska och engelska. Det vägrar låta mig publicera hälften av ettdera, vilket har räddat mig två gånger.',
      who: 'Medlemssekreterare',
    },
    {
      text: 'Jag ändrade en färg och mejlen ändrades med. Jag hade utgått från att det skulle bli ett supportärende.',
      who: 'Kommunikationsansvarig',
    },
  ],
};
