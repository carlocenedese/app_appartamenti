import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32 } from '../../src/zip';

/** The inflate the command line passes to the core. */
export const inflateRaw = (data: Uint8Array, maxOutputLength: number): Uint8Array =>
  inflateRawSync(data, { maxOutputLength });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (s: string) => new TextEncoder().encode(s);

/** A Word body part with these paragraphs, each paragraph a list of run texts. */
export function wordPart(paragraphs: readonly (readonly string[])[], root = 'w:document'): string {
  const body = paragraphs
    .map((runs) => `<w:p>${runs.map((t) => `<w:r><w:rPr/><w:t>${t}</w:t></w:r>`).join('')}</w:p>`)
    .join('');
  const inner = root === 'w:document' ? `<w:body>${body}</w:body>` : body;
  return `<?xml version="1.0" encoding="UTF-8"?><${root} xmlns:w="${W}">${inner}</${root}>`;
}

/**
 * A zip like the ones Word writes: every entry deflated (method 8), a data descriptor flag, sizes
 * in the central directory. Only what `readZip` needs to read it.
 */
export function zipDeflated(
  entries: readonly { path: string; data: string | Uint8Array; stored?: boolean }[],
  options: { flags?: number; badCrc?: boolean } = {},
): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? text(entry.data) : entry.data;
    const method = entry.stored === true ? 0 : 8;
    const packed = method === 0 ? raw : new Uint8Array(deflateRawSync(raw));
    const name = text(entry.path);
    const crc = options.badCrc === true ? (crc32(raw) ^ 1) >>> 0 : crc32(raw);
    const flags = options.flags ?? 0x0808;
    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    // CRC and sizes left at zero in the local header, as with a data descriptor.
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A minimal `.docx` whose body has these paragraphs (plus optional header and footer). */
export function docx(
  paragraphs: readonly (readonly string[])[],
  extra: { header?: string; footer?: string } = {},
): Uint8Array {
  return zipDeflated([
    { path: '[Content_Types].xml', data: '<Types/>' },
    { path: '_rels/.rels', data: '<Relationships/>' },
    { path: 'word/document.xml', data: wordPart(paragraphs) },
    ...(extra.header === undefined
      ? []
      : [{ path: 'word/header1.xml', data: wordPart([[extra.header]], 'w:hdr') }]),
    ...(extra.footer === undefined
      ? []
      : [{ path: 'word/footer1.xml', data: wordPart([[extra.footer]], 'w:ftr') }]),
  ]);
}
