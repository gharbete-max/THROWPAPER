import type { SiteCopy } from '../content.js';

/**
 * German.
 *
 * **"Sie", not "du".** The Nordic files use the informal address because Swedish, Danish and
 * Norwegian business writing dropped the formal one decades ago. German did not, and this product
 * is sold to associations, boards and treasurers — the audience for whom "du" from a vendor reads
 * as either a startup affecting familiarity or as impertinence. The same page is therefore
 * informal in Stockholm and formal in Hamburg on purpose, not by oversight.
 *
 * German runs roughly a third longer than English, and the compounds do not wrap. Where a literal
 * translation produced a word no button could hold, the sentence was rewritten rather than the
 * layout stretched — "Anmeldung" over "Registrierungsvorgang" every time.
 */
export const deDE: SiteCopy = {
  meta: {
    homeTitle: 'Formwork — Formulare, Anmeldungen und der Einlass',
    homeDescription:
      'Ein Formularwerkzeug für Organisationen, die es richtig machen müssen: zwölf Sprachen, Ihr Erscheinungsbild auf jeder Fläche und eine Eintrittskarte, die am Einlass gescannt wird.',
    titleSuffix: ' — Formwork',
  },
  chrome: {
    skipToContent: 'Zum Inhalt springen',
    siteNavLabel: 'Website',
    policiesNavLabel: 'Rechtliches',
    languageLabel: 'Sprache',
    openTheDemo: 'Demo öffnen',
    footerTagline:
      'Formwork. Formulare, Anmeldungen und der Einlass. Die Demo speichert nichts und versendet nichts.',
  },
  hero: {
    eyebrow: 'Formulare, Anmeldungen und der Einlass',
    title: 'Fragen Sie richtig.',
    body: 'Zwölf Sprachen, Ihr Erscheinungsbild auf jeder Fläche und eine Eintrittskarte, die am Einlass gescannt wird.',
    secondary: 'Ansehen, was es kann',
  },
  sections: {
    featuresEyebrow: 'Alles, was es kann',
    featuresTitle: 'Gebaut für den Tag, an dem es zählt',
    readMore: 'Mehr lesen',
    quotesEyebrow: 'Im Einsatz',
    quotesTitle: 'Was die Leute danach sagten',
    ctaTitle: 'Nichts zu installieren',
    ctaBody:
      'Die Demo läuft auf erfundenen Daten, versendet keine E-Mails und vergisst alles beim Neustart.',
  },
  featurePage: {
    backToAll: 'Alles, was es kann',
    back: 'Zurück',
    otherFeatures: 'Weitere Funktionen',
  },
  features: {
    forms: {
      name: 'Der Formular-Editor',
      summary:
        'Siebzehn Feldtypen, Bedingungen, die wirklich verzweigen, und eine Vorschau, die das Formular ist.',
      intro:
        'Feld hineinziehen, Frage schreiben, ansehen. Die Vorschau neben der Fläche ist derselbe Renderer, den auch die ausfüllende Person bekommt, keine Annäherung daran — was Sie beim Bauen sehen, ist das, was ausgefüllt wird.',
      points: [
        {
          heading: 'Siebzehn Arten von Fragen',
          body: 'Text, Zahlen, Datum und Uhrzeit, Einfach- und Mehrfachauswahl, Bewertungen, Dateien, Unterschriften. Dazu Schmuck: Formen und Freihandzeichnungen, die nichts erfassen und nie im Export auftauchen.',
        },
        {
          heading: 'Bedingungen, die sich nicht im Kreis drehen',
          body: 'Eine Frage darf von einer Antwort über ihr abhängen, und nur von einer darüber. Verweise nach vorn werden abgelehnt, und genau das macht einen Zyklus durch die Konstruktion unmöglich statt durch eine Prüfung, die zu spät läuft.',
        },
        {
          heading: 'Dreiundzwanzig Vorlagen',
          body: 'Veranstaltungen, Dienstleistungen, Bildung, Handel, Mitgliedschaft, Arbeitsplatz, Gremien und Forschung — jede vollständig in allen zwölf Sprachen. Eine Vorlage, die Englisch in ein finnisches Formular kopiert, ist kein Anfang.',
        },
      ],
    },
    events: {
      name: 'Veranstaltungen und der Einlass',
      summary:
        'Anmeldung, eine Eintrittskarte zum Ausdrucken und eine Einlass-Ansicht für die Tür.',
      intro:
        'Eine Veranstaltung ist ein Formular mit Datum, Höchstzahl und Tür. Alles nach der Anmeldung — von der Bestätigung bis zu der Person, die am Eingang eine Karte scannt — ist der Teil, der sonst improvisiert wird. Deshalb ist er eingebaut.',
      points: [
        {
          heading: 'Eine Eintrittskarte, die sich scannen lässt',
          body: 'Ein PDF mit den Angaben zur Veranstaltung und einem QR-Code, der ein signiertes Token trägt. Vier Module Ruhezone und Fehlerkorrektur auf dem Niveau, das gedruckte Codes brauchen — damit ein Knick quer durch das Symbol im Dezember an der Tür noch gelesen wird.',
        },
        {
          heading: 'Eine Ansicht für den Eingang',
          body: 'Große Schrift, ein großes Eingabefeld und ein Ergebnis, das man auf Armlänge lesen kann. Gebaut, um an der Tür einhändig gehalten zu werden, im schlechten WLAN des Veranstaltungsorts.',
        },
        {
          heading: 'Eine Höchstzahl, die etwas bedeutet',
          body: 'Eine volle Veranstaltung schließt sich selbst. Eine Warteliste ist eine Entscheidung, die Sie treffen, kein Zustand, den Sie entdecken.',
        },
      ],
    },
    responses: {
      name: 'Antworten',
      summary:
        'Alles, was eingeht, an einem Ort, exportierbar ohne zu verlieren, was die Zahlen bedeuteten.',
      intro:
        'Antworten landen in einem Eingang und einer Tabelle. Die Tabelle sortiert nach dem Wert statt nach dem Text, den Sie sehen — eine Zahlenspalte sortiert numerisch, und eine Spalte mit schwedischen Namen sortiert so, wie Schwedisch sortiert.',
      points: [
        {
          heading: 'Exporte, die eine Tabellenkalkulation überstehen',
          body: 'Eine CSV-Spalte je beantwortbarem Feld, benannt nach dem Feldschlüssel. Schmuck ist keine Spalte; eine gezeichnete Form ändert nichts an der Datei.',
        },
        {
          heading: 'Sortierung, die die Sprache kennt',
          body: 'ICU-Kollation: å ä ö kommen im Schwedischen nach z, und æ ø å sortieren so, wie Dänisch und Norwegisch es erwarten. Kein Byte-Vergleich, der sich den Namen einer Sprache umhängt.',
        },
        {
          heading: 'Nichts geht ohne Bestätigung hinaus',
          body: 'Jede ausgehende Aktion hat einen Testmodus und einen Schritt, der nachfragt. Eine E-Mail an vierhundert Menschen sollte zwei bewusste Klicks kosten.',
        },
      ],
    },
    brand: {
      name: 'Ihre Farben, überall',
      summary:
        'Eine Palette, kompiliert für die App, die E-Mail, das PDF und einen Dunkelmodus, den niemand zeichnen musste.',
      intro:
        'Ein Markenkit ist hier kein Stylesheet mit Ihrem Logo darin. Es ist ein Satz Tokens, kompiliert für vier Ziele — damit das Formular am Bildschirm, die Bestätigungsmail, die gedruckte Eintrittskarte und eine künftige App dieselbe Marke sind statt vier Annäherungen an sie.',
      points: [
        {
          heading: 'Ein Dunkelmodus, den Sie nicht angelegt haben',
          body: 'Die dunkle Palette wird aus der hellen abgeleitet und behält den Farbton jeder Farbe, statt sie ins Graue zu ziehen. Jede Organisation hat am Tag der Veröffentlichung ein dunkles Thema — auch die, die ihre Farben vor einem Jahr gewählt haben.',
        },
        {
          heading: 'Kontrast wird beim Auswählen geprüft',
          body: 'Die Warnung erscheint, während Sie eine Farbe wählen, nicht nachdem Sie gespeichert haben. Eine Warnung nach der Entscheidung ist ein Tadel und keine Hilfe.',
        },
        {
          heading: 'Skalen aus einer einzigen Zahl',
          body: 'Einen Radius setzen und eine Familie bekommen; eine Schriftgröße und ein Verhältnis, und Sie bekommen eine Skala. Nichts, was im Gleichschritt gehalten werden muss, und nichts Neues zu verstehen.',
        },
      ],
    },
    languages: {
      name: 'Zwölf Sprachen',
      summary:
        'Die Oberfläche, die Vorlagen, die E-Mails und die gedruckte Karte — nicht nur die Schaltflächen.',
      intro:
        'Englisch, Schwedisch, Dänisch, Norwegisch, Finnisch, Isländisch, Französisch, Deutsch, Spanisch, Chinesisch, Japanisch und Russisch. Die Oberfläche ist eine Sprache zur Zeit und das ist eine persönliche Einstellung; ein Formular ist ein Dokument und kann seine eigene Umschaltung anbieten.',
      points: [
        {
          heading: 'Auch das, was später ankommt',
          body: 'Bestätigungsmail und Eintrittskarte werden in der Sprache geschrieben, in der das Formular ausgefüllt wurde, und sagen das in ihrem eigenen Markup — damit ein Screenreader eine japanische E-Mail auf Japanisch liest.',
        },
        {
          heading: 'Eine fehlende Übersetzung blockiert die Veröffentlichung',
          body: 'Ein Formular, das zwei Sprachen behauptet und eine hat, ist nicht fertig. Die Vollständigkeitsprüfung ist im Editor derselbe Code wie am Endpunkt, also können die beiden sich nicht widersprechen.',
        },
        {
          heading: 'Pluralformen und Kollation, keine Zeichenkettenverkettung',
          body: 'Anzahlen lesen sich richtig in Sprachen mit mehr als zwei Pluralformen, und Listen sortieren nach den Regeln der Sprache statt nach Zeichencode.',
        },
      ],
    },
    ledger: {
      name: 'Ein Journal, das sich nicht ändern lässt',
      summary:
        'Doppelte Buchführung, nur Anfügen. Ein Fehler wird storniert, nie stillschweigend umgeschrieben.',
      intro:
        'Gebühren, Kautionen und Erstattungen ordentlich verbucht. Es gibt darin weder Ändern noch Löschen: eine falsche Buchung wird durch eine Storno-Buchung berichtigt, die die Seiten tauscht — so bleiben das Original und die Berichtigung beide im Bestand.',
      points: [
        {
          heading: 'Exakte Arithmetik',
          body: 'Beträge sind bigint in der kleinsten Währungseinheit, nie Gleitkomma. Ein Cent, den es nicht gibt, ist keine Rundungsart, sondern ein Fehler mit langem Nachlauf.',
        },
        {
          heading: 'Alle Mängel auf einmal',
          body: 'Eine Buchung, die nicht ausgeglichen ist, meldet alle ihre Probleme statt des ersten — eine Buchung zu berichtigen ist dann ein Durchgang und nicht vier.',
        },
        {
          heading: 'Stornieren, nicht löschen',
          body: 'Das, was ein Journal zu einem Journal macht. Etwas durchzustreichen und am Rand abzuzeichnen ist die Papierfassung derselben Regel.',
        },
      ],
    },
  },
  quotes: [
    {
      text: 'Die Eintrittskarten wurden beim ersten Versuch gescannt, im Regen, mit Warteschlange. Das war die ganze Prüfung.',
      who: 'Veranstaltungsleitung, ordentliche Mitgliederversammlung',
    },
    {
      text: 'Wir veröffentlichen auf Deutsch und Englisch. Es weigert sich, mich eine Hälfte davon veröffentlichen zu lassen, was mich zweimal gerettet hat.',
      who: 'Mitgliederverwaltung',
    },
    {
      text: 'Ich habe eine Farbe geändert, und die E-Mails haben sich mitgeändert. Ich hatte mit einem Support-Ticket gerechnet.',
      who: 'Leitung Kommunikation',
    },
  ],
};
