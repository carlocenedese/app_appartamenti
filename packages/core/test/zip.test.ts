import { describe, expect, it } from 'vitest';
import { crc32, zipStored } from '../src/zip';

const text = (s: string) => new TextEncoder().encode(s);
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe('crc32', () => {
  it('gives the IEEE check value and 0 for no bytes', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zipStored', () => {
  it('writes one stored entry with consistent local header, central directory and end', () => {
    const zip = zipStored([{ path: 'a.txt', data: text('abc') }]);
    expect(zip.length).toBe(30 + 5 + 3 + 46 + 5 + 22);
    const v = view(zip);
    const crc = crc32(text('abc'));
    // Local header.
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(4, true)).toBe(20);
    expect(v.getUint16(6, true)).toBe(0);
    expect(v.getUint16(8, true)).toBe(0);
    expect(v.getUint16(10, true)).toBe(0);
    expect(v.getUint16(12, true)).toBe(0x0021);
    expect(v.getUint32(14, true)).toBe(crc);
    expect(v.getUint32(18, true)).toBe(3);
    expect(v.getUint32(22, true)).toBe(3);
    expect(v.getUint16(26, true)).toBe(5);
    expect(v.getUint16(28, true)).toBe(0);
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(zip.subarray(35, 38))).toBe('abc');
    // Central directory.
    const central = 38;
    expect(v.getUint32(central, true)).toBe(0x02014b50);
    expect(v.getUint16(central + 10, true)).toBe(0);
    expect(v.getUint16(central + 14, true)).toBe(0x0021);
    expect(v.getUint32(central + 16, true)).toBe(crc);
    expect(v.getUint32(central + 20, true)).toBe(3);
    expect(v.getUint32(central + 24, true)).toBe(3);
    expect(v.getUint16(central + 28, true)).toBe(5);
    expect(v.getUint32(central + 38, true)).toBe(0);
    expect(v.getUint32(central + 42, true)).toBe(0);
    // End of central directory.
    const end = central + 46 + 5;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 8, true)).toBe(1);
    expect(v.getUint16(end + 10, true)).toBe(1);
    expect(v.getUint32(end + 12, true)).toBe(46 + 5);
    expect(v.getUint32(end + 16, true)).toBe(central);
  });

  it('keeps the order of the entries and gives the same bytes twice', () => {
    const entries = [
      { path: '[Content_Types].xml', data: text('<a/>') },
      { path: 'xl/workbook.xml', data: text('<b/>') },
    ];
    const zip = zipStored(entries);
    const decoded = new TextDecoder().decode(zip);
    expect(decoded.indexOf('[Content_Types].xml')).toBeLessThan(decoded.indexOf('xl/workbook.xml'));
    expect(view(zip).getUint32(30 + 19 + 4, true)).toBe(0x04034b50);
    expect(zipStored(entries)).toEqual(zip);
  });

  it.each([
    ['no entries', []],
    ['an empty path', ['']],
    ['an absolute path', ['/a']],
    ['an empty segment', ['a//b']],
    ['a dot-dot segment', ['a/../b']],
    ['a dot segment', ['./a']],
    ['a backslash', ['a\\b']],
    ['a non-NFC path', ['é.txt']],
    ['a non-ASCII path', ['à.txt']],
    ['a duplicate path', ['a.txt', 'a.txt']],
  ])('refuses %s', (_, paths) => {
    expect(() => zipStored(paths.map((path) => ({ path, data: text('x') })))).toThrow(RangeError);
  });

  it('never puts the path in the message', () => {
    expect(() => zipStored([{ path: 'segreto/../x', data: text('') }])).toThrow(
      /^(?!.*segreto).*$/,
    );
  });
});
