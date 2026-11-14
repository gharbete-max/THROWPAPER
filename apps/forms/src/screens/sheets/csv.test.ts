import { describe, expect, it } from 'vitest';
import {
  analyse,
  changeDecimal,
  convert,
  decode,
  detectDecimal,
  detectSeparator,
  encode,
  parse,
  serialize,
} from './csv.js';

const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const utf8 = (s: string) => Uint8Array.from(Buffer.from(s, 'utf8'));

describe('decode', () => {
  it('reads UTF-8, with or without a mark, and says which', () => {
    expect(decode(utf8('Åsa;Öberg'))).toEqual({ text: 'Åsa;Öberg', encoding: 'utf-8', bom: false });
    const withMark = Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('Åsa')]);
    expect(decode(withMark)).toEqual({ text: 'Åsa', encoding: 'utf-8', bom: true });
  });

  it('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
    expect(decode(latin1('Åsa;Malmö;€'.replace('€', 'e')))).toMatchObject({
      text: 'Åsa;Malmö;e',
      encoding: 'windows-1252',
    });
    // 0x80 is the euro sign in Windows-1252 and nothing in Latin-1.
    expect(decode(Uint8Array.from([0x41, 0x80])).text).toBe('A€');
  });

  it('reads UTF-16 with its mark, and an encoding the person forces', () => {
    const utf16 = Uint8Array.from([0xff, 0xfe, ...Buffer.from('Åsa', 'utf16le')]);
    expect(decode(utf16)).toEqual({ text: 'Åsa', encoding: 'utf-16le', bom: true });
    const sjis = Uint8Array.from([0x82, 0xa0]); // あ
    expect(decode(sjis, 'shift_jis').text).toBe('あ');
  });
});

describe('detectSeparator', () => {
  it('finds each of the four, and prefers the one that splits every line alike', () => {
    expect(detectSeparator('a;b;c\r\n1;2;3\r\n')).toBe(';');
    expect(detectSeparator('a,b,c\n1,2,3\n')).toBe(',');
    expect(detectSeparator('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    expect(detectSeparator('a|b|c\n1|2|3\n')).toBe('|');
    // Swedish numbers hold commas, but the semicolons are what every line agrees on.
    expect(detectSeparator('Namn;Belopp\nAnna;1 234,50\nBo;99,5\n')).toBe(';');
  });

  it('does not count separators inside quotes, and defaults to a comma for one column', () => {
    expect(detectSeparator('"a;b",c\n"d;e",f\n')).toBe(',');
    expect(detectSeparator('Name\nAnna\n')).toBe(',');
  });
});

describe('parse and serialize', () => {
  it('handles quotes, doubled quotes, line breaks inside a field and every kind of row break', () => {
    const text = 'a;"b;1";"say ""hi"""\r\n"two\nlines";x;y\rlast;;';
    expect(parse(text, ';')).toEqual([
      ['a', 'b;1', 'say "hi"'],
      ['two\nlines', 'x', 'y'],
      ['last', '', ''],
    ]);
  });

  it('round-trips, quoting only what has to be', () => {
    const rows = [
      ['a', 'b;c', 'say "hi"', 'two\nlines'],
      ['', '1,5', 'x', 'y'],
    ];
    const text = serialize(rows, ';');
    expect(text).toBe('a;"b;c";"say ""hi""";"two\nlines"\r\n;1,5;x;y\r\n');
    expect(parse(text, ';')).toEqual(rows);
    expect(serialize([['a', 'b']], ',', 'all')).toBe('"a","b"\r\n');
  });

  it('changes the separator without touching a decimal comma', () => {
    const rows = parse('Namn;Belopp\nAnna;1 234,50\n', ';');
    expect(serialize(rows, ',')).toBe('Namn,Belopp\r\nAnna,"1 234,50"\r\n');
  });
});

describe('decimal marks', () => {
  it('tells a decimal comma from a decimal point, or neither, or a mix', () => {
    expect(detectDecimal(parse('a;b\n1 234,50;3,5\n', ';'))).toBe(',');
    expect(detectDecimal(parse('a,b\n1234.50,3.5\n', ','))).toBe('.');
    expect(detectDecimal(parse('a;b\nx;12\n', ';'))).toBeNull();
    expect(detectDecimal(parse('a;b\n1,5;2.5\n', ';'))).toBeNull();
    expect(detectDecimal(parse('a;b\n1,5;2,5;3,5;4,5\n9.5\n', ';'))).toBe(',');
  });

  it('changes whole-cell numbers only, dropping thousands marks, and leaves ids, dates and text alone', () => {
    const rows = [['1 234,50', '00,5', '1,5 kg', '2024-01-03', '0123', '-7,25', '1.234,5']];
    const { rows: out, changed } = changeDecimal(rows, ',', '.');
    expect(out).toEqual([['1234.50', '00,5', '1,5 kg', '2024-01-03', '0123', '-7.25', '1234.5']]);
    expect(changed).toBe(3);
    expect(changeDecimal([['3.5', '1,234.5']], '.', ',').rows).toEqual([['3,5', '1234,5']]);
  });
});

describe('encode', () => {
  it('writes UTF-8 with a mark so Excel reads å ä ö, or without', () => {
    const { bytes } = encode('Åsa', 'utf-8-bom');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.from(bytes.subarray(3)).toString('utf8')).toBe('Åsa');
    expect(encode('Åsa', 'utf-8').bytes.length).toBe(4);
  });

  it('writes Windows-1252, and counts what it cannot write', () => {
    const ok = encode('Åsa Öberg €5 “x”', 'windows-1252');
    expect(ok.unencodable).toBe(0);
    expect(Buffer.from(ok.bytes).toString('latin1')).toContain('Åsa Öberg ');
    expect(ok.bytes).toContain(0x80);
    const lost = encode('Zoë 日本', 'windows-1252');
    expect(lost.unencodable).toBe(2);
    expect(Buffer.from(lost.bytes).toString('latin1')).toBe('Zoë ??');
  });

  it('round-trips through decode', () => {
    const text = 'Namn;Ort\r\nÅsa;Malmö\r\n';
    expect(decode(encode(text, 'windows-1252').bytes).text).toBe(text);
    expect(decode(encode(text, 'utf-8-bom').bytes).text).toBe(text);
  });
});

describe('analyse and convert: a Swedish file made ready for an English Excel, and back', () => {
  const swedish = latin1('Namn;Belopp;Ort\r\nÅsa Öberg;1 234,50;Malmö\r\nBo;99,5;Lund\r\n');

  it('reads the file for what it is', () => {
    const a = analyse(swedish);
    expect(a.decoded).toMatchObject({ encoding: 'windows-1252', bom: false });
    expect(a.separator).toBe(';');
    expect(a.decimal).toBe(',');
    expect(a.rows[1]).toEqual(['Åsa Öberg', '1 234,50', 'Malmö']);
    // A wrong guess is overridden, and the rows follow.
    expect(analyse(swedish, null, ',').rows[0]).toHaveLength(1);
  });

  it('writes comma separated, decimal point, UTF-8 with a mark, and says what changed', () => {
    const a = analyse(swedish);
    const out = convert(a.rows, {
      separator: ',',
      from: a.decimal,
      to: '.',
      encoding: 'utf-8-bom',
    });
    expect(out.changed).toBe(2);
    expect(out.unencodable).toBe(0);
    expect(decode(out.bytes).text).toBe(
      'Namn,Belopp,Ort\r\nÅsa Öberg,1234.50,Malmö\r\nBo,99.5,Lund\r\n',
    );
  });

  it('keeps the numbers when asked, and when there is nothing to change', () => {
    const a = analyse(swedish);
    const kept = convert(a.rows, {
      separator: ';',
      from: a.decimal,
      to: 'keep',
      encoding: 'utf-8',
    });
    expect(kept.changed).toBe(0);
    expect(decode(kept.bytes).text).toContain('1 234,50');
    const same = convert(a.rows, { separator: ';', from: ',', to: ',', encoding: 'utf-8' });
    expect(same.changed).toBe(0);
    expect(
      convert(a.rows, { separator: ';', from: null, to: '.', encoding: 'utf-8' }).changed,
    ).toBe(0);
  });

  it('turns an English file into one a Swedish Excel opens in columns', () => {
    const english = utf8('Name,Amount\nAnna,"1,234.50"\nBo,3.5\n');
    const a = analyse(english);
    expect(a.separator).toBe(',');
    expect(a.decimal).toBe('.');
    const out = convert(a.rows, {
      separator: ';',
      from: a.decimal,
      to: ',',
      encoding: 'utf-8-bom',
    });
    expect(decode(out.bytes).text).toBe('Name;Amount\r\nAnna;1234,50\r\nBo;3,5\r\n');
  });
});
