/**
 * What a mail program that shows text only displays for a campaign: the message as it is sent
 * (it is already plain text; there is no other part), folded at the width such programs fold at.
 * And the links in it, listed so the sender can see each one. Links are never tracked or
 * rewritten: what is listed is exactly what is in the message.
 */
export const TEXT_WIDTH = 72;

/** Lines folded at spaces to `width`; a word longer than that (a long link) stays whole. */
export function foldText(text: string, width = TEXT_WIDTH): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= width) return line;
      const out: string[] = [];
      let current = '';
      for (const word of line.split(' ')) {
        if (current !== '' && (current + ' ' + word).length > width) {
          out.push(current);
          current = word;
        } else current = current === '' ? word : `${current} ${word}`;
      }
      out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

/** Web and mail links in a text, once each, in order of appearance, without trailing punctuation. */
export function linksIn(text: string): string[] {
  const found = text.match(/(?:https?:\/\/|mailto:)[^\s<>"]+/gi) ?? [];
  return [...new Set(found.map((link) => link.replace(/[.,;:!?)\]}'’]+$/, '')))];
}
