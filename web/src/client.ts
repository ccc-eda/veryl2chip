// Asynchronous access to the core: in a Web Worker when the browser allows
// it (blob worker), otherwise directly on the main thread.

import { fromBase64, gunzip, Veryl } from './api';

declare const WORKER_SRC: string;
declare const VERYL_CHIPDB_GZ_B64: string | undefined;

export interface Core {
  call<T>(req: object): Promise<T>;
  /** load the chip database for place and route (once) */
  chipdb(): Promise<void>;
  readonly inWorker: boolean;
}

export async function startCore(wasm: Uint8Array): Promise<Core> {
  const mod = await WebAssembly.compile(wasm as BufferSource);
  try {
    return await workerCore(mod);
  } catch {
    return directCore(mod);
  }
}

function chipdbGz(): Uint8Array {
  if (typeof VERYL_CHIPDB_GZ_B64 === 'undefined') throw new Error('chipdb.js (晶片資料庫) 沒有載入');
  return fromBase64(VERYL_CHIPDB_GZ_B64);
}

async function workerCore(mod: WebAssembly.Module): Promise<Core> {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const w = new Worker(url);
  let next = 1;
  const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error !== undefined) p.fail(new Error(e.data.error)); else p.ok(e.data.res);
  };
  const send = (msg: object, transfer: Transferable[] = []) => new Promise<unknown>((ok, fail) => {
    const id = next++;
    pending.set(id, { ok, fail });
    w.postMessage({ ...msg, id }, transfer);
  });
  w.onerror = () => { for (const p of pending.values()) p.fail(new Error('worker 錯誤')); pending.clear(); };
  // the worker must answer the init message, or we fall back
  await Promise.race([send({ type: 'init', module: mod }), new Promise((_, f) => setTimeout(() => f(new Error('worker timeout')), 5000))]);
  let db: Promise<void> | null = null;
  return {
    inWorker: true,
    call: <T>(req: object) => send({ type: 'call', req }) as Promise<T>,
    chipdb: () => {
      if (!db) { const gz = chipdbGz(); db = send({ type: 'chipdb', gz }, [gz.buffer]).then(() => {}); db.catch(() => { db = null; }); }
      return db;
    },
  };
}

function directCore(mod: WebAssembly.Module): Core {
  const v = Veryl.fromModule(mod);
  let db: Promise<void> | null = null;
  return {
    inWorker: false,
    call: <T>(req: object) => new Promise<T>((ok, fail) => setTimeout(() => { try { ok(v.call<T>(req)); } catch (e) { fail(e as Error); } }, 10)),
    chipdb: () => (db ??= gunzip(chipdbGz()).then(t => v.loadChipdb(t))),
  };
}
