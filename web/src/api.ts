// The WebAssembly core (veryl-sim + veryl-eda compiled from Rust).
// No DOM here: the same code runs in the browser and in the Node tests.

export interface VFile { name: string; src: string }
export interface ModuleInfo { name: string; test: boolean }
export interface TopResult { name: string; fails: number; finished: boolean }
export interface SimResult { log: string; tops: TopResult[]; vcd: { top: string; text: string }[] }

interface Exports {
  memory: WebAssembly.Memory;
  load_chipdb(p: number, n: number): number;
  alloc(n: number): number;
  dealloc(p: number, n: number): void;
  call(p: number, n: number): number;
  result_len(): number;
  panic_message(): number;
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export class Veryl {
  private x!: Exports;

  private constructor(private mod: WebAssembly.Module) { this.reset(); }

  static async load(bytes: Uint8Array): Promise<Veryl> {
    return new Veryl(await WebAssembly.compile(bytes as BufferSource));
  }

  static fromModule(mod: WebAssembly.Module): Veryl { return new Veryl(mod); }

  private chipdb: Uint8Array | null = null;

  /** chip database text (IceStorm chipdb-5k.txt) for place and route */
  loadChipdb(text: Uint8Array): void {
    this.chipdb = text;
    this.pushChipdb();
  }

  private pushChipdb(): void {
    if (!this.chipdb) return;
    const x = this.x;
    const p = x.alloc(this.chipdb.length);
    new Uint8Array(x.memory.buffer, p, this.chipdb.length).set(this.chipdb);
    const r = x.load_chipdb(p, this.chipdb.length);
    x.dealloc(p, this.chipdb.length);
    if (r !== 0) throw new Error(this.text(x.panic_message()));
  }

  /** a trap (Rust panic) leaves the instance unusable: start a fresh one */
  private reset(): void {
    this.x = new WebAssembly.Instance(this.mod, {}).exports as unknown as Exports;
    if (this.chipdb) this.pushChipdb();
  }

  private text(ptr: number): string {
    return new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, ptr, this.x.result_len()).slice());
  }

  call<T>(req: object): T {
    const enc = new TextEncoder().encode(JSON.stringify(req));
    const x = this.x;
    const p = x.alloc(enc.length);
    new Uint8Array(x.memory.buffer, p, enc.length).set(enc);
    let out: number;
    try {
      out = x.call(p, enc.length);
    } catch (e) {
      let msg = String(e);
      try { msg = this.text(x.panic_message()) || msg; } catch { /* keep the trap message */ }
      this.reset();
      throw new Error(msg);
    }
    const s = this.text(out);
    x.dealloc(p, enc.length);
    const r = JSON.parse(s);
    if (!r.ok) throw new Error(r.error);
    return r as T;
  }

  list(files: VFile[]): ModuleInfo[] {
    return this.call<{ modules: ModuleInfo[] }>({ cmd: 'list', files }).modules;
  }

  simulate(files: VFile[], top?: string, opts: { maxTime?: number; vcd?: boolean } = {}): SimResult {
    return this.call<SimResult>({ cmd: 'simulate', files, top: top || null, max_time: opts.maxTime ?? 1_000_000, vcd: !!opts.vcd });
  }
}

/** gunzip with the platform's DecompressionStream (browsers, Node >= 18) */
export async function gunzip(gz: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([gz as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
