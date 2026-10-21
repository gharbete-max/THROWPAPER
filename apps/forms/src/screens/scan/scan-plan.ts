/**
 * The page list of the Scan screen, as plain data: which page of which file, in what order, turned
 * how far. Kept apart from the screen so what the buttons do can be tested without a browser, and
 * turned into the request `POST /v1/pdf/arrange` takes (`api-forms/src/pdf/arrange.ts`).
 */
export type Turn = 0 | 90 | 180 | 270;

export interface ScanPage {
  /** Stable while the page is on the screen: its file and its place in that file. */
  id: string;
  /** Index into the files the person has added. */
  file: number;
  /** Page within that file, from 0. */
  page: number;
  /** How far the person has turned it, clockwise. */
  turn: Turn;
}

export function pagesOfFile(file: number, count: number): ScanPage[] {
  return Array.from({ length: count }, (_, page) => ({
    id: `${file}-${page}`,
    file,
    page,
    turn: 0,
  }));
}

export function movePage(pages: readonly ScanPage[], id: string, by: -1 | 1): ScanPage[] {
  const from = pages.findIndex((page) => page.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= pages.length) return [...pages];
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function turnPage(pages: readonly ScanPage[], id: string): ScanPage[] {
  return pages.map((page) =>
    page.id === id ? { ...page, turn: ((page.turn + 90) % 360) as Turn } : page,
  );
}

export function removePage(pages: readonly ScanPage[], id: string): ScanPage[] {
  return pages.filter((page) => page.id !== id);
}

/** Only the files still used travel, numbered in the order they first appear. */
export function requestOf(
  pages: readonly ScanPage[],
  files: readonly File[],
): { files: File[]; plan: Array<{ file: number; page: number; rotate: Turn }> } {
  const order: number[] = [];
  for (const page of pages) if (!order.includes(page.file)) order.push(page.file);
  return {
    files: order.map((index) => files[index]!),
    plan: pages.map((page) => ({
      file: order.indexOf(page.file),
      page: page.page,
      rotate: page.turn,
    })),
  };
}
