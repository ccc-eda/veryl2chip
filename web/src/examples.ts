// Example projects; the sources are generated into dist/examples.js by build.mjs.

import type { VFile } from './api';
import { tr } from './i18n';

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
  /** English title and note */
  title_en?: string;
  note_en?: string;
  group_en?: string;
  /** what is plugged into the virtual board */
  board?: import('./ide/board').BoardSetup;
  /** runs in the emulator (machine.json), not in the testbench simulator */
  emu?: boolean;
  /** the development board's breadboard (machine.json "board": "pi"; default: pi.ts's) */
  piBoard?: import('./ide/bbmodel').Part[];
}

declare const VERYL_EXAMPLES: Example[];

export function examples(): Example[] {
  return typeof VERYL_EXAMPLES === 'undefined' ? [] : VERYL_EXAMPLES;
}

export function exTitle(e: Example): string { return tr(e.title, e.title_en ?? e.title); }
export function exNote(e: Example): string { return e.note ? tr(e.note, e.note_en ?? e.note) : ''; }
export function exGroup(e: Example): string { return tr(e.group, e.group_en ?? e.group); }
