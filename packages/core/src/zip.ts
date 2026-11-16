/**
 * A zip archive with every entry stored (method 0, no compression), written byte for byte the
 * same for the same entries: fixed date and time (1 January 1980, 00:00), entries in the order
 * given, no extra fields, no zip64. It is the container of the generated `.xlsx` (plan 5, R150).
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const VERSION = 20;
/** MS-DOS date of 1 January 1980: year 0, month 1, day 1. */
const DOS_DATE = 0x0021;
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;
const SAFE_PATH = /^[A-Za-z0-9._/[\]-]+$/;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (IEEE, polynomial `0xEDB88320`) of `data`, unsigned. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

function assertPath(path: string): void {
  // Constant messages: the path may carry a name.
  if (path === '' || path.normalize('NFC') !== path || !SAFE_PATH.test(path)) {
    throw new RangeError('Invalid zip entry path');
  }
  if (path.startsWith('/') || path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new RangeError('Invalid zip entry path');
  }
}

/**
 * The zip of `entries`, stored, in the order given. Throws a `RangeError` (constant message) for
 * no entries, an invalid or repeated path, more than 65 535 entries or a size beyond 4 GiB.
 */
export function zipStored(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length === 0) throw new RangeError('A zip needs at least one entry');
  if (entries.length > MAX_ENTRIES) throw new RangeError('Too many zip entries');
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  const prepared = entries.map(({ path, data }) => {
    assertPath(path);
    if (seen.has(path)) throw new RangeError('Duplicate zip entry path');
    seen.add(path);
    if (data.length > MAX_SIZE) throw new RangeError('Zip entry too large');
    return { name: encoder.encode(path), data, crc: crc32(data) };
  });

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  if (localSize > MAX_SIZE || localSize + centralSize > MAX_SIZE) {
    throw new RangeError('Zip too large');
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let at = 0;
  const u16 = (n: number) => {
    v.setUint16(at, n, true);
    at += 2;
  };
  const u32 = (n: number) => {
    v.setUint32(at, n, true);
    at += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, at);
    at += b.length;
  };
  // Shared by the local header (from the version) and the central directory (from offset 6).
  const common = (e: (typeof prepared)[number]) => {
    u16(VERSION);
    u16(0); // flags
    u16(0); // method: stored
    u16(0); // time
    u16(DOS_DATE);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra field length
  };

  const offsets: number[] = [];
  for (const e of prepared) {
    offsets.push(at);
    u32(LOCAL_HEADER);
    common(e);
    bytes(e.name);
    bytes(e.data);
  }
  prepared.forEach((e, index) => {
    u32(CENTRAL_HEADER);
    u16(VERSION); // version made by
    common(e);
    u16(0); // comment length
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[index] as number);
    bytes(e.name);
  });
  u32(END_OF_CENTRAL);
  u16(0);
  u16(0);
  u16(prepared.length);
  u16(prepared.length);
  u32(centralSize);
  u32(localSize);
  u16(0); // comment length
  return out;
}
