// Example projects; the sources are generated into dist/examples.js by build.mjs.

import type { VFile } from './api';

export interface Example {
  id: string;
  group: string;
  title: string;
  files: VFile[];
  /** module to synthesize by default */
  synth?: string;
  /** pin constraints for the FPGA flow */
  pcf?: string;
  /** shown under the title */
  note?: string;
}

declare const VERYL_EXAMPLES: Example[];

export function examples(): Example[] {
  return typeof VERYL_EXAMPLES === 'undefined' ? [] : VERYL_EXAMPLES;
}
