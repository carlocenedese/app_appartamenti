/**
 * Fills a Word template (plan 12, R230): the `{{campo}}` placeholders of the body, headers,
 * footers and notes are replaced by text values; every other zip entry passes through untouched
 * and the result is written with `zipStored` (the same bytes for the same inputs). Word saves its
 * files deflated: the inflate is an argument, so the core stays without `node:zlib`.
 */
import { escapeXml, NOT_XML } from './xlsx-write';
import { crc32, zipStored } from './zip';
import type { ZipEntry } from './zip';

/**
 * Raw deflate (RFC 1951) → bytes, never more than `maxOutputLength`; the command line passes
 * `zlib.inflateRawSync` with that option.
 */
export type InflateRaw = (data: Uint8Array, maxOutputLength: number) => Uint8Array;

/** Limits against a zip bomb or a file that is not a form, checked before inflating. */
export const DOCX_LIMITS = {
  /** Bytes of the template file. */
  templateBytes: 32 * 1024 * 1024,
  /** Bytes of one entry once inflated. */
  entryBytes: 64 * 1024 * 1024,
  /** Bytes of all entries once inflated. */
  totalBytes: 128 * 1024 * 1024,
  entries: 10_000,
} as const;

export type DocxRefusal = {
  status: 'refused';
  reason:
    | 'bad-template'
    | 'bad-placeholder'
    | 'unclosed-placeholder'
    | 'missing-fields'
    | 'bad-value'
    | 'unfilled-elsewhere';
  /** Field names only (never a value), sorted. */
  fields: string[];
};

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const BODY_PART = /^word\/(document|header[0-9]*|footer[0-9]*|footnotes|endnotes)\.xml$/;
// An empty w:t, a w:t with its text, or a separator a placeholder never crosses: the end of a
// paragraph, a tab, a line or carriage break.
const TOKEN =
  /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:(?:tab|br|cr)\b[^>]*\/>/g;
const W_T = /<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g;
const XML_ENTRY = /\.(xml|rels)$/;
const PLACEHOLDER = /\{\{([^{}\n]*)\}\}/g;
const FIELD_NAME = /^[a-z0-9_]+$/;

const invalid = (): never => {
  // Constant message: the bytes are the user's file.
  throw new RangeError('Invalid zip');
};

interface ZipItem {
  path: string;
  method: number;
  crc: number;
  size: number;
  packed: Uint8Array;
}

/** The central directory of a zip with every check that comes before inflating. */
function zipDirectory(bytes: Uint8Array): ZipItem[] {
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
  if (end < 0 || bytes.length > DOCX_LIMITS.templateBytes) invalid();
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === 0xffffffff) invalid(); // zip64
  if (count > DOCX_LIMITS.entries) invalid();
  let total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const items: ZipItem[] = [];
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
    // The declared size, checked before inflating; the inflate is capped at it.
    total += size;
    if (size > DOCX_LIMITS.entryBytes || total > DOCX_LIMITS.totalBytes) invalid();
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
    items.push({ path, method, crc, size, packed: bytes.subarray(start, start + packedSize) });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }
  return items;
}

/**
 * The entries of a zip, in the order of its central directory. Stored (0) and deflate (8) only;
 * sizes from the central directory; CRC checked. Throws a `RangeError` (constant message) for bytes
 * that are not such a zip, an encrypted or zip64 one, or a wrong size or CRC.
 */
export function readZip(bytes: Uint8Array, inflateRaw: InflateRaw): ZipEntry[] {
  return zipDirectory(bytes).map(({ path, method, crc, size, packed }) => {
    let data = packed;
    if (method === 8) {
      try {
        data = inflateRaw(packed, Math.max(1, size));
      } catch {
        invalid();
      }
    }
    if (data.length !== size || crc32(data) !== crc) invalid();
    return { path, data };
  });
}

/**
 * Plan 26, R404: inflates the deflated entries of `bytes` ahead with an asynchronous inflate (the
 * webview only has `DecompressionStream`) and gives the synchronous `InflateRaw` that `readZip`
 * takes for the same bytes. An entry that does not inflate, or bytes that are not a zip, are left
 * to `readZip` to refuse.
 */
export async function inflateAhead(
  bytes: Uint8Array,
  inflate: (data: Uint8Array, maxOutputLength: number) => Promise<Uint8Array>,
): Promise<InflateRaw> {
  const inflated = new Map<number, Uint8Array>();
  let items: ZipItem[] = [];
  try {
    items = zipDirectory(bytes);
  } catch {
    // readZip throws the same error.
  }
  for (const { method, size, packed } of items) {
    if (method !== 8) continue;
    try {
      inflated.set(packed.byteOffset, await inflate(packed, Math.max(1, size)));
    } catch {
      // Left out: readZip refuses it.
    }
  }
  return (data) => {
    const done = inflated.get(data.byteOffset);
    if (done === undefined) throw new RangeError('Not inflated');
    return done;
  };
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
    if (!/^<w:t[\s/>]/.test(match[0])) {
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
  // shortcut: the main part is taken at its usual path, not from `_rels/.rels`; a template whose
  // main part lives elsewhere is `bad-template`.
  if (!entries.some((e) => e.path === 'word/document.xml')) return refuse('bad-template');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = new Map<string, Scanned>();
  const fields = new Set<string>();
  for (const { path, data } of entries) {
    if (!XML_ENTRY.test(path)) continue;
    let xml: string;
    try {
      xml = decoder.decode(data);
    } catch {
      return refuse('bad-template');
    }
    const body = BODY_PART.test(path);
    // A `{{` the app does not fill (comments, properties, charts, field codes): never left behind.
    if ((body ? xml.replace(W_T, '') : xml).includes('{{')) return refuse('unfilled-elsewhere');
    if (!body) continue;
    const scanned = scan(xml);
    if (scanned.joined.includes('{{{') || scanned.joined.includes('}}}')) {
      return refuse('bad-placeholder');
    }
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
 * XML does not allow or a `{{` (`bad-value`), a `{{` outside the text the app fills
 * (`unfilled-elsewhere`), a `{{` in the filled text (`unclosed-placeholder`); `{{{` and `}}}` are
 * `bad-placeholder`. Values with no placeholder are ignored; a line break
 * in a value becomes a Word line break.
 */
export function fillDocx(
  template: Uint8Array,
  values: Readonly<Record<string, string>>,
  inflateRaw: InflateRaw,
): { status: 'ok'; bytes: Uint8Array } | DocxRefusal {
  const parsed = parse(template, inflateRaw);
  if (parsed.status !== 'ok') return parsed;
  const missing = parsed.fields.filter((name) => !Object.hasOwn(values, name));
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
  let left = false;
  const entries = parsed.entries.map(({ path, data }) => {
    const part = parsed.parts.get(path);
    if (part === undefined) return { path, data };
    const xml = fillPart(part, normalised);
    // A value next to a brace of the template could make a new `{{`: refused, not written.
    if (scan(xml).joined.includes('{{')) left = true;
    return { path, data: encoder.encode(xml) };
  });
  if (left) return refuse('unclosed-placeholder');
  try {
    return { status: 'ok', bytes: zipStored(entries) };
  } catch {
    return refuse('bad-template');
  }
}
