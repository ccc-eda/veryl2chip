// What a project can do, from its files alone: which title bar actions apply (and why the
// others do not, with a way to fix it), the suggested first step, and the example list's
// badges. No DOM: npm test checks every example with it.

import { tr } from '../i18n';

/** the title bar's actions */
export type Act = 'test' | 'verify' | 'board' | 'emu' | 'synth';
/** what an off action offers instead */
export type Fix = 'flashAnyway' | 'addPcf' | 'openProgram' | 'emu' | 'openBoardExample';
export interface Cap { on: boolean; why?: string; fix?: Fix[] }

export interface CapInput {
  files: { name: string; src: string }[];
  /** the modules (from the parser); null while not known */
  mods: { name: string; test: boolean }[] | null;
  /** the module synthesized */
  top: string;
  /** the open tab */
  active?: string;
}

interface Machine { top?: string; files?: unknown }
function machine(files: CapInput['files']): Machine | null {
  const f = files.find(x => x.name === 'machine.json');
  if (!f) return null;
  try { return JSON.parse(f.src) as Machine; } catch { return null; }
}

/** a file the board's Linux runs (MicroPython, shell, C) */
export const boardProgram = (n: string) => /\.(py|sh|c)$/.test(n);
const hasTests = (i: CapInput) => i.mods ? i.mods.some(m => m.test) : i.files.some(f => f.name.endsWith('.veryl') && /#\[test\b/.test(f.src));
const hasPcf = (i: CapInput) => i.files.some(f => f.name.endsWith('.pcf'));

export function caps(i: CapInput): Record<Act, Cap> {
  const m = machine(i.files);
  const tests = hasTests(i);
  const program = i.files.some(f => boardProgram(f.name)) && !!m?.files;
  const noTests: Cap = { on: false, why: tr('這個專案沒有 #[test] 模組（testbench），沒有東西可以測試。寫法見手冊第 4 章。', 'This project has no #[test] module (testbench): nothing to test. See chapter 4 of the manual.') };
  const isMachine: Cap = {
    on: false,
    why: tr(`這個專案是一台模擬機（machine.json）：${m?.top ?? ''} 太大，不能用 testbench 模擬。按「🖥 模擬機」開機${program ? '，或打開板上的程式（.py / .c / .sh）按「▶ 執行」' : ''}。`,
      `This project is a machine (machine.json): ${m?.top ?? ''} is too large for the testbench simulator. Boot it with "🖥 Emulator"${program ? ', or open a program for the board (.py / .c / .sh) and press "▶ Run"' : ''}.`),
    fix: program ? ['openProgram', 'emu'] : ['emu'],
  };
  const runOnBoard = !!m?.files && !!i.active && boardProgram(i.active) && i.files.some(f => f.name === i.active);
  return {
    test: runOnBoard ? { on: true } : m ? isMachine : tests ? { on: true } : noTests,
    verify: m ? isMachine : tests ? { on: true } : noTests,
    board: m
      ? { on: false, why: tr('這個專案是一台模擬機（machine.json），放不進虛擬 iCEBreaker 的 FPGA。請用「🖥 模擬機」。', 'This project is a machine (machine.json): it does not fit the virtual iCEBreaker\'s FPGA. Use "🖥 Emulator".'), fix: ['emu'] }
      : !i.top
        ? { on: false, why: tr('沒有可合成的模組：#[test] 模組（testbench）不能燒錄。', 'No synthesizable module: #[test] modules (testbenches) cannot be flashed.') }
        : !hasPcf(i)
          ? { on: false, why: tr('這個專案沒有腳位檔（.pcf），不知道設計的埠接到板子的哪支腳。仍要燒錄的話會用 iCEBreaker 的預設腳位（i_clk、i_rst、o_led[0..4]、i_btn、o_ledr、o_ledg、i_rx、o_tx），名字不同的埠不會接到任何東西。', 'This project has no pin file (.pcf): the design\'s ports are not assigned to the board\'s pins. Flashing anyway uses the iCEBreaker defaults (i_clk, i_rst, o_led[0..4], i_btn, o_ledr, o_ledg, i_rx, o_tx); ports with other names stay unconnected.'), fix: ['addPcf', 'flashAnyway'] }
          : { on: true },
    emu: m ? { on: true } : { on: false, why: tr('模擬機要有 machine.json（說明機器的頂層、UART、RAM 與要載入的映像）。範例「RV64 開發板」就是一台。', 'The emulator needs a machine.json (the machine\'s top, UART, RAM and the images to load). The "RV64 board" example is one.'), fix: ['openBoardExample'] },
    synth: i.top ? { on: true } : { on: false, why: tr('沒有可合成的模組（只有 #[test] 模組）。', 'No synthesizable module (only #[test] modules).') },
  };
}

/** the suggested first step: a machine boots, a design with pins goes on the board, else its tests, else synthesis */
export function start(i: CapInput): Act {
  const c = caps({ ...i, active: undefined });
  if (c.emu.on) return 'emu';
  if (c.board.on) return 'board';
  if (c.test.on) return 'test';
  return 'synth';
}

/** the suggested steps, first one first (at most three) */
export function steps(i: CapInput): Act[] {
  const c = caps({ ...i, active: undefined });
  const s = start(i);
  if (s === 'emu') return ['emu'];
  return [s, ...(['test', 'board', 'synth'] as Act[]).filter(a => a !== s && c[a].on)].slice(0, 3);
}

/** an example's badges: what it can do (🧪 tests, ⚡ virtual board, 🖥 emulator) */
export function badges(i: CapInput): { icon: string; act: Act }[] {
  const c = caps({ ...i, active: undefined });
  return ([['🧪', 'test'], ['⚡', 'board'], ['🖥', 'emu']] as [string, Act][]).filter(([, a]) => c[a].on).map(([icon, act]) => ({ icon, act }));
}

/** an action's name in the title bar */
export function actName(a: Act): string {
  return { test: tr('▶ 測試', '▶ Test'), verify: tr('✔ 全面驗證', '✔ Verify all'), board: tr('⚡ 虛擬板', '⚡ Virtual board'), emu: tr('🖥 模擬機', '🖥 Emulator'), synth: tr('⚙ 合成', '⚙ Synthesize') }[a];
}

/** what a step does, under its button */
export function actHint(a: Act, i: CapInput): string {
  const m = machine(i.files);
  if (a === 'emu') return m?.files
    ? tr('開機（幾秒），然後打開 main.py 等板上的程式按「▶ 執行」', 'boot it (a few seconds), then open a program such as main.py and press "▶ Run"')
    : tr('讓這台機器開機', 'boot this machine');
  if (a === 'board') return i.files.some(f => f.name.endsWith('.c'))
    ? tr('把 SoC 和 C 程式放上虛擬板，按按鈕、看 LED 和終端機', 'put the SoC and the C program on the virtual board: press buttons, watch the LEDs and the terminal')
    : tr('燒進虛擬板，按按鈕、看 LED', 'flash it to the virtual board: press buttons, watch the LEDs');
  if (a === 'test') return tr('跑 testbench，看結果和波形', 'run the testbenches, see the results and waveforms');
  if (a === 'synth') return tr('看電路變成什麼：閘、FPGA、晶片版圖', 'see what the circuit becomes: gates, FPGA, chip layout');
  return '';
}
