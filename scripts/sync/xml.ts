// The transparency files are flat, machine-generated XML. A tolerant tag scanner is faster and
// more forgiving here than a full XML parser: chains differ in casing, encoding and compression.

import { gunzipSync, inflateRawSync } from 'node:zlib';

/** Decompress (gzip / single-entry zip / plain) and decode (UTF-8 / UTF-16) a downloaded file. */
export function decodeFile(raw: Buffer): string {
  let buf = raw;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf);
  } else if (buf[0] === 0x50 && buf[1] === 0x4b) {
    buf = unzipFirstEntry(buf);
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  // UTF-16 without a byte-order mark: every other byte of the leading "<?xml" or "<Root" is zero.
  if (buf.length > 4 && buf[0] === 0x3c && buf[1] === 0 && buf[3] === 0) return new TextDecoder('utf-16le').decode(buf);
  if (buf.length > 4 && buf[0] === 0 && buf[1] === 0x3c && buf[2] === 0) return new TextDecoder('utf-16be').decode(buf);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const head = buf.subarray(0, 200).toString('latin1').toLowerCase();
  if (head.includes('windows-1255') || head.includes('iso-8859-8')) {
    return new TextDecoder('windows-1255').decode(buf);
  }
  return buf.toString('utf8');
}

/** Minimal zip reader: returns the first file entry (stored or deflated). */
function unzipFirstEntry(buf: Buffer): Buffer {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Unsupported zip file');
  const flags = buf.readUInt16LE(6);
  const method = buf.readUInt16LE(8);
  let compressedSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (flags & 0x08 || compressedSize === 0) {
    // Sizes live in the central directory; inflate until the stream ends on its own.
    compressedSize = buf.length - start;
  }
  const data = buf.subarray(start, start + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported zip compression method ${method}`);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tagCache = new Map<string, RegExp>();

/** Text content of the first `<name>…</name>` in `block` (case-insensitive), or ''. */
export function tag(block: string, name: string): string {
  let re = tagCache.get(name);
  if (!re) {
    // Text may be wrapped in CDATA: <ItemName><![CDATA[...]]></ItemName>.
    re = new RegExp(`<${name}(?:\\s[^>]*)?>((?:<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|[^<])*)</${name}\\s*>`, 'i');
    tagCache.set(name, re);
  }
  const m = re.exec(block);
  if (!m) return '';
  const raw = m[1].includes('<![CDATA[') ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : decodeEntities(m[1]);
  return raw.trim();
}

/** First non-empty value among several possible tag names. */
export function tagAny(block: string, ...names: string[]): string {
  for (const n of names) {
    const v = tag(block, n);
    if (v) return v;
  }
  return '';
}

/** Inner contents of every `<name>…</name>` element. Elements of the same name must not nest. */
export function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
