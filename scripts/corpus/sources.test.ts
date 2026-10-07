import { describe, expect, it } from 'vitest';
import { corpusSources, keptBy, scanSources } from './sources.js';

/**
 * The corpus's manifests as they are read (`sources.ts`): a real document — one nobody here wrote —
 * is read only with its licence, where it was found, when, whom to credit, and its hash.
 */
const sha256 = 'a'.repeat(64);
const source = {
  url: 'https://www.example.gov/forms/sf-1.pdf',
  retrieved: '2026-10-06',
  attribution: 'U.S. General Services Administration',
};
const real = {
  name: 'sf-1',
  language: 'en',
  summary: 'A federal form as published, with its own form fields.',
  features: ['acroform'],
  origin: 'real',
  licence: 'PD-USGov',
  source,
  files: { pdf: { path: 'sf-1.pdf', sha256 } },
};
const made = {
  name: 'membership',
  language: 'en',
  summary: 'An English membership form made for the corpus.',
  features: ['consent'],
  spec: 'scripts/corpus/documents.ts',
  files: { pdf: { path: 'membership.pdf', sha256 }, docx: { path: 'membership.docx', sha256 } },
};
const manifest = (...documents: object[]) => ({
  $comment: 'The golden corpus.',
  licence: 'CC0-1.0',
  tool: 'LibreOffice 24.2.7.2',
  documents,
});
const without = (key: string, from: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(from).filter(([name]) => name !== key));

describe("the corpus's manifest", () => {
  it('reads a made document and a real one', () => {
    expect(() => corpusSources.parse(manifest(made, real))).not.toThrow();
  });

  it.each([
    ['no licence', without('licence', real)],
    ['a licence that does not let it be kept', { ...real, licence: 'All rights reserved' }],
    ['no source', without('source', real)],
    ['no URL', { ...real, source: without('url', source) }],
    ['no retrieval date', { ...real, source: without('retrieved', source) }],
    ['a retrieval date that is no date', { ...real, source: { ...source, retrieved: 'October' } }],
    ['no attribution', { ...real, source: { ...source, attribution: '' } }],
    ['no sha256', { ...real, files: { pdf: { path: 'sf-1.pdf' } } }],
    ['no file', { ...real, files: {} }],
    ['a permission it does not say who gave', { ...real, licence: 'permission' }],
    [
      'a permission beside a licence',
      { ...real, permission: { from: 'Demo AB', date: '2026-10-06', scope: 'the corpus' } },
    ],
  ])('refuses a real document with %s', (_, document) => {
    expect(() => corpusSources.parse(manifest(document))).toThrow();
  });

  it("takes a customer's blank form with their written permission", () => {
    const permission = {
      from: 'Demo AB',
      date: '2026-10-06',
      scope: 'the corpus, in a public repo',
    };
    expect(() =>
      corpusSources.parse(manifest({ ...real, licence: 'permission', permission })),
    ).not.toThrow();
  });

  it('refuses a made document in only one format, or with a source of its own', () => {
    expect(() =>
      corpusSources.parse(manifest({ ...made, files: { pdf: made.files.pdf } })),
    ).toThrow();
    expect(() => corpusSources.parse(manifest({ ...made, source }))).toThrow();
  });
});

describe("the scans' manifest", () => {
  const scanned = {
    name: 'membership',
    from: 'membership.pdf',
    locale: 'en-GB',
    dpi: 200,
    skew: 0.3,
    files: { png: { path: 'membership.png', sha256 } },
  };
  const photographed = {
    name: 'kort-1920',
    summary: 'A membership card printed in the 1920s, blank, photographed.',
    image: 'kort-1920.jpg',
    locale: 'sv-SE',
    origin: 'real',
    licence: 'PD-old-70',
    source: { ...source, url: 'https://commons.wikimedia.org/wiki/File:Kort.jpg' },
    files: { jpg: { path: 'kort-1920.jpg', sha256 } },
  };
  const scans = (...entries: object[]) => ({
    licence: 'CC0-1.0',
    tool: 'pdfjs-dist@6.3.289 + Tesseract 5.1.0-288-g2a9c1',
    scans: entries,
  });

  it('reads a scan of a corpus document and a picture of real paper', () => {
    expect(() => scanSources.parse(scans(scanned, photographed))).not.toThrow();
  });

  it.each([
    ['no licence', without('licence', photographed)],
    ['no URL', { ...photographed, source: without('url', source) }],
    ['no retrieval date', { ...photographed, source: without('retrieved', source) }],
    ['no sha256', { ...photographed, files: { jpg: { path: 'kort-1920.jpg' } } }],
    ['a picture it does not list', { ...photographed, image: 'kort-1921.jpg' }],
  ])('refuses a picture of real paper with %s', (_, entry) => {
    expect(() => scanSources.parse(scans(entry))).toThrow();
  });
});

describe('what `pnpm corpus:build` keeps', () => {
  const documents = corpusSources.parse(manifest(made, real)).documents;

  it('keeps every real document, and rebuilds every made one', () => {
    expect(keptBy(documents, ['membership'], false).map((doc) => doc.name)).toEqual(['sf-1']);
  });

  it('keeps the made documents it does not build, when it builds only some', () => {
    expect(keptBy(documents, ['other'], true).map((doc) => doc.name)).toEqual([
      'membership',
      'sf-1',
    ]);
  });

  it('never writes a real document', () => {
    expect(() => keptBy(documents, ['sf-1'], true)).toThrow(/sf-1 is a real document/);
  });
});
