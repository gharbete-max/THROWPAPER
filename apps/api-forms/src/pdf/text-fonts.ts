import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {
  degrees,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';

/**
 * Which font prints which character, when text is added to a PDF (`edit.ts`).
 *
 * Decided by measuring (`docs/plan/NEXT.md` 1b), per character, first match wins:
 *
 * 1. **Helvetica**, a standard font every reader has, so nothing is embedded. Its WinAnsi set is
 *    all of Latin-1 plus œ š ž € and the usual punctuation: every letter of da de en es fi fr is nb
 *    sv, digits and symbols included.
 * 2. **Inter, Cyrillic subset** (`@fontsource/inter`, OFL, already a dependency of `@tp/tokens`):
 *    Russian. 10 KB. It has no digits or punctuation of its own; those come from Helvetica.
 * 3. **Noto Sans JP** (`assets/fonts`, OFL) for Japanese: kana, 100 % of the 6 355 kanji of JIS
 *    X 0208, full-width punctuation. 1.6 MB.
 * 4. **Noto Sans SC** (`assets/fonts`, OFL) for Chinese: 5 717 of the 6 768 hanzi of GB 2312
 *    (the 1 051 rarest are missing, so are refused). 1.6 MB.
 *
 * Text with a kana tries the Japanese font before the Chinese one, otherwise the other way round,
 * because a kanji looks different in each. A face is read from disk only when a character needs
 * it, and what goes into the PDF is a subset: the glyphs used, a few KB, never the whole font.
 *
 * Why woff, not woff2: `@pdf-lib/fontkit` throws, after the call has returned, when it subsets a
 * woff2 font (measured), and a thrown error nobody can catch ends the process.
 */
type FaceId = 'cyrillic' | 'japanese' | 'chinese';

const FACE_FILES: Record<FaceId, string> = {
  cyrillic: 'inter-cyrillic-400-normal.woff',
  japanese: 'noto-sans-jp-japanese-400.woff',
  chinese: 'noto-sans-sc-chinese-simplified-400.woff',
};

/** Where a face's file is, or null when this installation does not carry it. */
function faceFile(face: FaceId): string | null {
  if (face === 'cyrillic') {
    try {
      return createRequire(import.meta.url).resolve(`@fontsource/inter/files/${FACE_FILES[face]}`);
    } catch {
      return null;
    }
  }
  // `assets/fonts` sits beside `src` and beside `dist`: found by walking up from either.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i += 1, dir = dirname(dir)) {
    const candidate = join(dir, 'assets', 'fonts', FACE_FILES[face]);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface LoadedFace {
  bytes: Uint8Array;
  has(codePoint: number): boolean;
}

/** Kept for the life of the process: reading and parsing a 1.6 MB font is not done twice. */
const loaded = new Map<FaceId, LoadedFace | null>();

function loadFace(face: FaceId): LoadedFace | null {
  if (!loaded.has(face)) {
    const file = faceFile(face);
    if (!file) {
      loaded.set(face, null);
    } else {
      const bytes = new Uint8Array(readFileSync(file));
      const font = fontkit.create(bytes) as { hasGlyphForCodePoint(codePoint: number): boolean };
      loaded.set(face, { bytes, has: (codePoint) => font.hasGlyphForCodePoint(codePoint) });
    }
  }
  return loaded.get(face)!;
}

/** Characters no available font can print, so nothing is drawn and the person is told which. */
export class UnsupportedText extends Error {
  constructor(readonly characters: string[]) {
    super(`No font for: ${characters.join(' ')}`);
  }
}

/** A character needs a font this installation does not carry (the CJK files, on a trimmed build). */
export class FontUnavailable extends Error {
  constructor(readonly characters: string[]) {
    super(`This server has no font for: ${characters.join(' ')}`);
  }
}

const KANA = /[぀-ヿ]/u;

type Choice = 'standard' | FaceId;

/** Runs of text, each in one font. */
export class TextFonts {
  private readonly embedded = new Map<Choice, PDFFont>();
  private winAnsi: Set<number> | undefined;

  constructor(private readonly doc: PDFDocument) {
    doc.registerFontkit(fontkit);
  }

  private async font(choice: Choice): Promise<PDFFont> {
    let font = this.embedded.get(choice);
    if (!font) {
      font =
        choice === 'standard'
          ? await this.doc.embedFont(StandardFonts.Helvetica)
          : await this.doc.embedFont(loadFace(choice)!.bytes, { subset: true });
      this.embedded.set(choice, font);
    }
    return font;
  }

  /** The font for each character of one line, or the characters nothing can print. */
  private async choose(line: string): Promise<Array<{ char: string; choice: Choice }>> {
    this.winAnsi ??= new Set((await this.font('standard')).getCharacterSet());
    const order: FaceId[] = KANA.test(line)
      ? ['cyrillic', 'japanese', 'chinese']
      : ['cyrillic', 'chinese', 'japanese'];
    const chars: Array<{ char: string; choice: Choice }> = [];
    const refused: string[] = [];
    const missing: string[] = [];
    for (const char of line) {
      const codePoint = char.codePointAt(0)!;
      if (this.winAnsi.has(codePoint)) {
        chars.push({ char, choice: 'standard' });
        continue;
      }
      const available = order.filter((face) => loadFace(face));
      const face = available.find((candidate) => loadFace(candidate)!.has(codePoint));
      if (face) chars.push({ char, choice: face });
      else if (available.length < order.length && codePoint > 0x2e7f) missing.push(char);
      else refused.push(char);
    }
    if (refused.length > 0) throw new UnsupportedText([...new Set(refused)]);
    if (missing.length > 0) throw new FontUnavailable([...new Set(missing)]);
    return chars;
  }

  /**
   * Checks that every character can be printed, without drawing, so a refusal comes before any
   * page is changed.
   */
  async check(text: string): Promise<void> {
    for (const line of text.split('\n')) await this.choose(line);
  }

  /** Draws `text` with its baseline starting at (x, y), turned `angle` degrees anticlockwise. */
  async draw(
    page: PDFPage,
    text: string,
    at: { x: number; y: number; size: number; color: RGB; angle: number },
  ): Promise<void> {
    const radians = (at.angle * Math.PI) / 180;
    const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
    const lineHeight = at.size * 1.2;
    for (const [row, line] of text.split('\n').entries()) {
      // Each following line starts one line height "below", in the direction the text is turned.
      let x = at.x + sin * lineHeight * row;
      let y = at.y - cos * lineHeight * row;
      let run = '';
      let runChoice: Choice | undefined;
      const flush = async () => {
        if (!run || !runChoice) return;
        const font = await this.font(runChoice);
        page.drawText(run, {
          x,
          y,
          size: at.size,
          font,
          color: at.color,
          rotate: degrees(at.angle),
        });
        const advance = font.widthOfTextAtSize(run, at.size);
        x += cos * advance;
        y += sin * advance;
        run = '';
      };
      for (const { char, choice } of await this.choose(line)) {
        if (choice !== runChoice) {
          await flush();
          runChoice = choice;
        }
        run += char;
      }
      await flush();
    }
  }
}

/** `#rrggbb` to a colour, or null when it is not one. */
export function hexColor(hex: string): RGB | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map((part) => parseInt(part, 16) / 255);
  return rgb(r!, g!, b!);
}
