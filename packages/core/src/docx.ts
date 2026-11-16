/**
 * Fills a Word template (plan 12, R230): the `{{campo}}` placeholders of the body, headers,
 * footers and notes are replaced by text values; every other zip entry passes through untouched
 * and the result is written with `zipStored` (the same bytes for the same inputs). Word saves its
 * files deflated: the inflate is an argument, so the core stays without `node:zlib`.
 */
import { escapeXml, NOT_XML } from './xlsx-write';
import { crc32, zipStored } from './zip';
import type { ZipEntry } from './zip';

/** Raw deflate (RFC 1951) → bytes; the command line passes `zlib.inflateRawSync`. */
export type InflateRaw = (data: Uint8Array) => Uint8Array;

export type DocxRefusal = {
  status: 'refused';
  reason:
    'bad-template' | 'bad-placeholder' | 'unclosed-placeholder' | 'missing-fields' | 'bad-value';
  /** Field names only (never a value), sorted. */
  fields: string[];
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const BODY_PART = /^word\/(document|header[0-9]*|footer[0-9]*|footnotes|endnotes)\.xml$/;
// An empty w:t, a w:t with its text, or the end of a paragraph (placeholders never cross it).
const TOKEN = /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>/g;
const PLACEHOLDER = /\{\{([^{}\n]*)\}\}/g;
const FIELD_NAME = /^[a-z0-9_]+$/;

const invalid = (): never => {
  // Constant message: the bytes are the user's file.
  throw new RangeError('Invalid zip');
};

/**
 * The entries of a zip, in the order of its central directory. Stored (0) and deflate (8) only;
 * sizes from the central directory; CRC checked. Throws a `RangeError` (constant message) for bytes
 * that are not such a zip, an encrypted or zip64 one, or a wrong size or CRC.
 */
export function readZip(bytes: Uint8Array, inflateRaw: InflateRaw): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => (at + 2 <= bytes.length ? v.getUint16(at, true) : invalid());
  const u32 = (at: number) => (at + 4 <= bytes.length ? v.getUint32(at, true) : invalid());
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (v.getUint32(at, true) === END_OF_CENTRAL) {
      end = at;
      break;
    }
  }
  if (end < 0) invalid();
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === 0xffffffff) invalid(); // zip64
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(at) !== CENTRAL_HEADER) invalid();
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const packedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const offset = u32(at + 42);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) invalid();
    if (at + 46 + nameLength > bytes.length) invalid();
    let path = '';
    try {
      path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      invalid();
    }
    if (u32(offset) !== LOCAL_HEADER) invalid();
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + packedSize > bytes.length) invalid();
    const packed = bytes.subarray(start, start + packedSize);
    let data = packed;
    if (method === 8) {
      try {
        data = inflateRaw(packed);
      } catch {
        invalid();
      }
    }
    if (data.length !== size || crc32(data) !== crc) invalid();
    entries.push({ path, data });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }
  return entries;
}

function decodeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g, (whole, name: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name in named) return named[name] as string;
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

interface Piece {
  start: number;
  end: number;
  text: string;
}

interface Scanned {
  xml: string;
  pieces: Piece[];
  joined: string;
  /** For each character of `joined`: its piece (−1 for a paragraph end) and offset there. */
  owner: number[];
  offset: number[];
}

function scan(xml: string): Scanned {
  const pieces: Piece[] = [];
  let joined = '';
  const owner: number[] = [];
  const offset: number[] = [];
  for (const match of xml.matchAll(TOKEN)) {
    if (match[0] === '</w:p>') {
      joined += '\n';
      owner.push(-1);
      offset.push(0);
      continue;
    }
    const text = decodeXml(match[1] ?? '');
    for (let i = 0; i < text.length; i += 1) {
      owner.push(pieces.length);
      offset.push(i);
    }
    joined += text;
    pieces.push({ start: match.index, end: match.index + match[0].length, text });
  }
  return { xml, pieces, joined, owner, offset };
}

type Parsed =
  | { status: 'ok'; entries: ZipEntry[]; parts: Map<string, Scanned>; fields: string[] }
  | DocxRefusal;

const refuse = (reason: DocxRefusal['reason'], fields: string[] = []): DocxRefusal => ({
  status: 'refused',
  reason,
  fields,
});

function parse(template: Uint8Array, inflateRaw: InflateRaw): Parsed {
  let entries: ZipEntry[];
  try {
    entries = readZip(template, inflateRaw);
  } catch {
    return refuse('bad-template');
  }
  if (!entries.some((e) => e.path === 'word/document.xml')) return refuse('bad-template');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = new Map<string, Scanned>();
  const fields = new Set<string>();
  for (const { path, data } of entries) {
    if (!BODY_PART.test(path)) continue;
    let xml: string;
    try {
      xml = decoder.decode(data);
    } catch {
      return refuse('bad-template');
    }
    const scanned = scan(xml);
    for (const [, name] of scanned.joined.matchAll(PLACEHOLDER)) {
      if (!FIELD_NAME.test(name ?? '')) return refuse('bad-placeholder');
      fields.add(name as string);
    }
    if (scanned.joined.replace(PLACEHOLDER, '').includes('{{')) {
      return refuse('unclosed-placeholder');
    }
    parts.set(path, scanned);
  }
  return { status: 'ok', entries, parts, fields: [...fields].sort() };
}

/** The placeholder names of a template, sorted, each once. */
export function docxPlaceholders(
  template: Uint8Array,
  inflateRaw: InflateRaw,
): { status: 'ok'; fields: string[] } | DocxRefusal {
  const parsed = parse(template, inflateRaw);
  return parsed.status === 'ok' ? { status: 'ok', fields: parsed.fields } : parsed;
}

function fillPart({ xml, pieces, joined, owner, offset }: Scanned, values: Record<string, string>) {
  const texts = pieces.map((p) => p.text);
  const matches = [...joined.matchAll(PLACEHOLDER)].reverse();
  for (const match of matches) {
    const first = match.index;
    const last = first + match[0].length - 1;
    const sp = owner[first] as number;
    const so = offset[first] as number;
    const ep = owner[last] as number;
    const eo = (offset[last] as number) + 1;
    const value = values[match[1] as string] as string;
    if (sp === ep) {
      texts[sp] = (texts[sp] as string).slice(0, so) + value + (texts[sp] as string).slice(eo);
      continue;
    }
    texts[sp] = (texts[sp] as string).slice(0, so) + value;
    for (let p = sp + 1; p < ep; p += 1) texts[p] = '';
    texts[ep] = (texts[ep] as string).slice(eo);
  }
  let out = '';
  let from = 0;
  pieces.forEach((piece, index) => {
    const text = texts[index] as string;
    if (text === piece.text) return;
    const body = escapeXml(text).replaceAll('\n', '</w:t><w:br/><w:t xml:space="preserve">');
    out += `${xml.slice(from, piece.start)}<w:t xml:space="preserve">${body}</w:t>`;
    from = piece.end;
  });
  return out + xml.slice(from);
}

/**
 * The template with every placeholder replaced by its value. Refused, never half filled: a
 * template that is not a readable `.docx` or has an entry path `zipStored` refuses
 * (`bad-template`), a placeholder name not `[a-z0-9_]+` (`bad-placeholder`), a `{{` left open
 * (`unclosed-placeholder`), placeholders with no value (`missing-fields`), a value with a character
 * XML does not allow or a `{{` (`bad-value`). Values with no placeholder are ignored; a line break
 * in a value becomes a Word line break.
 */
export function fillDocx(
  template: Uint8Array,
  values: Readonly<Record<string, string>>,
  inflateRaw: InflateRaw,
): { status: 'ok'; bytes: Uint8Array } | DocxRefusal {
  const parsed = parse(template, inflateRaw);
  if (parsed.status !== 'ok') return parsed;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(values, name);
  const missing = parsed.fields.filter((name) => !has(name));
  if (missing.length > 0) return refuse('missing-fields', missing);
  const normalised: Record<string, string> = {};
  for (const name of parsed.fields) {
    normalised[name] = (values[name] as string).replace(/\r\n?/g, '\n');
  }
  const bad = parsed.fields.filter(
    (name) =>
      NOT_XML.test(normalised[name] as string) || (normalised[name] as string).includes('{{'),
  );
  if (bad.length > 0) return refuse('bad-value', bad);
  const encoder = new TextEncoder();
  const entries = parsed.entries.map(({ path, data }) => {
    const part = parsed.parts.get(path);
    return part === undefined
      ? { path, data }
      : { path, data: encoder.encode(fillPart(part, normalised)) };
  });
  try {
    return { status: 'ok', bytes: zipStored(entries) };
  } catch {
    return refuse('bad-template');
  }
}
