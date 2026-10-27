// A small ustar writer / reader for the emulator's file exchange (busybox tar on the
// board reads and writes this format). Regular files only (text or bytes); no DOM.

const enc = new TextEncoder();
const dec = new TextDecoder();

function octal(n: number, len: number): string { return n.toString(8).padStart(len - 1, '0') + '\0'; }

/** a tar of the files (text or bytes), mode 0644 unless given (0755: a program) */
export function tarFiles(files: { name: string; src: string | Uint8Array; mode?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const body = typeof f.src === 'string' ? enc.encode(f.src) : f.src;
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(enc.encode(s).subarray(0, s.length), at);
    put(f.name.slice(0, 99), 0);
    put(octal(f.mode ?? 0o644, 8), 100);
    put(octal(0, 8), 108);
    put(octal(0, 8), 116);
    put(octal(body.length, 12), 124);
    put(octal(Math.floor(Date.now() / 1000), 12), 136);
    put('        ', 148);
    h[156] = 0x30; // regular file
    put('ustar\0', 257);
    put('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    put(octal(sum, 7) + ' ', 148);
    parts.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** the regular files of a tar (name without a leading "./", text, and the bytes) */
export function untarFiles(t: Uint8Array): { name: string; src: string; data: Uint8Array }[] {
  const out: { name: string; src: string; data: Uint8Array }[] = [];
  for (let at = 0; at + 512 <= t.length;) {
    const h = t.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, n: number) => dec.decode(h.subarray(a, a + n)).replace(/\0.*$/s, '');
    let name = str(0, 100);
    const prefix = str(257, 6).startsWith('ustar') ? str(345, 155) : '';
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 0x30);
    at += 512;
    if (type === '0' || type === '\0') { const data = t.slice(at, at + size); out.push({ name: name.replace(/^\.\//, ''), src: dec.decode(data), data }); }
    at += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** the exchange area's contents: the line "VERYLFS <bytes>" in a 512-byte block, then the tar */
export function exchangeArea(tar: Uint8Array): Uint8Array {
  const head = enc.encode(`VERYLFS ${tar.length}\n`);
  const out = new Uint8Array(512 + tar.length);
  out.set(head);
  out.set(tar, 512);
  return out;
}

/** the tar in an exchange area (null: none) */
export function readExchangeArea(area: Uint8Array): Uint8Array | null {
  const line = dec.decode(area.subarray(0, 64)).split('\n')[0];
  const m = /^VERYLFS (\d+)$/.exec(line);
  if (!m) return null;
  return area.slice(512, 512 + Number(m[1]));
}
