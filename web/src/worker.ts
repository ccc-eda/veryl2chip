// Runs the WebAssembly core off the page's main thread. The page creates
// this worker from a blob (works from file://) and sends it the compiled
// module; requests are {id, req} and come back as {id, res} or {id, error}.

import { gunzip, Veryl } from './api';

let core: Veryl | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      core = Veryl.fromModule(m.module);
      (self as unknown as Worker).postMessage({ id: m.id, res: true });
    } else if (m.type === 'chipdb') {
      core!.loadChipdb(await gunzip(m.gz));
      (self as unknown as Worker).postMessage({ id: m.id, res: true });
    } else {
      (self as unknown as Worker).postMessage({ id: m.id, res: core!.call(m.req) });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String((err as Error).message ?? err) });
  }
};
