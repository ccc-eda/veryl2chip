# 11. Web IDE

<https://ccc-eda.github.io/veryl2chip/web/dist/index.html>

The whole toolchain (simulator, synthesizer, FPGA and ASIC flows, C compiler) is compiled to WebAssembly and served on a web page,
**no server needed, no code uploaded**: all computation happens in your browser. Download the whole `web/dist/` directory and open it with `file://` to use it offline.

## Layout

```
┌ Title bar: [Main button ▾] (advanced: Verify │ See the circuit │ Run it)     ⌘ Commands  Advanced ▸  Language ┐
├────────┬──────────────────────────────────────────────────┤
│ Activity │ Editor tabs: files, ⚙ Synthesis flow, ⚡ Virtual iCEBreaker, Assembly │
│ bar    │                                                    │
│ Sidebar├──────────────────────────────────────────────────┤
│ Files  │ Panels: Problems │ Output │ Test results │ Waveform                     │
│ Modules│                                                    │
│ Tests  │                                                    │
│ Examples                                                    │
├────────┴──────────────────────────────────────────────────┤
│ Status bar: WebAssembly, check results, tests, synthesis statistics                    │
└───────────────────────────────────────────────────────────┘
```

| Area | Content |
|---|---|
| Sidebar · Files | The project's files (`.veryl`, `pins.pcf`, at most one `.c`); ＋ to add, hover a filename for ✎ rename and 🗑 delete |
| Sidebar · Modules | Each module, and which ones are `#[test]`; click to jump to the definition |
| Sidebar · Tests | ▶ for each testbench with its pass / fail status, plus "Run all" |
| Sidebar · Examples | The example library (below); click to open as a new project |
| Panels | Problems (syntax errors appear as you type; click to jump to the line), Output, Test results, Waveform. Drag the top edge of a panel to resize (drag up from a collapsed panel to expand), double-click the top edge to restore the default height; height and collapsed state are remembered |

The interface comes in Traditional Chinese, English, and Simplified Chinese (menu at the right of the title bar).

### Main button and menu (v2.27)

The blue button at the far left of the title bar is the **main button**: the recommended next step for this project. It follows the project:

| Project | Main button |
|---|---|
| A machine (has `machine.json`, e.g. the RV64 board) | 🖥 Machine (boot) |
| A board project with a `.py` / `.c` / `.sh` open | ▶ Run `main.py` (run the open program on the board) |
| Has a pin file (`.pcf`) | ⚡ Virtual board |
| Anything else (with a testbench) | ▶ Test |

The **▾** next to it lists all actions, grouped into three by "what you want to do", each with a one-line description:

| Group | Actions |
|---|---|
| Verify | ▶ Test, ✔ Full verification |
| See the circuit | ⚙ Synthesis: FPGA (iCE40), ASIC · vlib, ASIC · SKY130, ⇄ FPGA vs ASIC comparison |
| Run it | ⚡ Virtual board, 🖥 Machine (RV64 board can choose riscv-emu or veryl-emu) |

The recommended action is labeled "Recommended". Actions this project cannot use are dimmed, and the description says why; clicking one pops up the reason and what you can do, e.g. "add pins.pcf",
"flash anyway (default pins)", "open main.py", "🖥 boot".

**Basic and advanced**: the default is Basic, where the title bar has only the main button and ▾; the synthesis menu (target, stage, top) appears only when the synthesis flow tab is open. Press
"Advanced ▸" at the right of the title bar (or the bottom of the ▾ menu, or the command menu) to switch to Advanced: all controls sit in the title bar, in three groups — "Verify" (▶ Test, test top,
RTL / gate-level simulation, ✔ Full verification), "See the circuit" (target, stage, top), and "Run it" (⚡ Virtual board, 🖥 Machine) — wrapping to two rows on narrow windows. Buttons this project
cannot use are still dimmed with a dashed border and explain themselves when clicked. The choice is remembered in the browser.

The **suggested steps** above the editor list this project's ①②③ (e.g. ① ⚡ Virtual board → ② ▶ Test → ③ ⚙ Synthesis); click one to do it.
× closes them; "Show suggested steps" in the command menu turns them back on.

### On a phone

Below 760 px of screen width (phone in portrait), the layout changes automatically:

- **Title bar**: only the main button and ▾, ⌘ Commands, and **⋯**; ⋯ expands all the controls of the three groups ("Verify", "See the circuit", "Run it") plus the language menu.
  Tapping the breadcrumb of the synthesis flow tab also expands it.
- **Sidebar**: hidden normally; tap an icon in the left activity bar to slide it in from the left, over the editor; it retracts when you pick a file or example, or tap the editor.
- **Editor**: 16 px text (so phones don't auto-zoom while typing); the panel tabs scroll horizontally, panel heights can be dragged.
- **Synthesis flow**: the chip picture on top, the description below; **Virtual board**: the control bar scrolls horizontally, and the board takes the full width.

The features are exactly the same as on desktop (the same page); URL parameters and shared lab links work as usual.

## Projects

- Projects are stored in the browser's localStorage (saved automatically on every edit; they are gone if you switch computers or clear site data — download anything important).
- The welcome page (shown the first time you open the IDE; reopen from "Welcome page" in the command menu) first asks **what do you want to do?** (v2.28), with four cards, each with a starting example:

  | Card | Starting example | "Start here" does |
  |---|---|---|
  | 🧪 Learn Veryl | Lesson 1, Blinky | Open and run the test (see the results and waveform) |
  | ⚡ Build a circuit and put it on a board (like Arduino) | Lab: traffic-light state machine | Open and flash to the virtual board (breadboard already wired) |
  | 🖥 Boot a computer and write programs (like a Raspberry Pi) | RV64 board | Open and boot |
  | ⚙ See the circuit become a chip | FIFO 256×8 | Open and synthesize |

  "See examples like this" opens the example library filtered to that category. Below are ＋ New project, 📚 Open example, ⇪ Import `.veryl` files, and recent projects.
  Choosing a card only decides where you start; the interface is never locked: the main button and ▾ keep following the project.
- Projects opened from an example can be edited without affecting the example; "Restore example source" returns to the original, and edited files are marked on their tabs.
- Downloading a project `.zip` gives `Veryl.toml` + `src/`, a project the official `veryl` can use; `v2c` reads `src/*.veryl` directly.
- C programs: name the file `xxx.c` when adding it (one per project), and the design must use `RvBoard` (easiest to start from the "C programs" example).

## Testing and verification

| Action | Command-line equivalent |
|---|---|
| ▶ Test (Ctrl/⌘+Enter) | `v2c sim` |
| Simulate: RTL / gate-level: generic gates / iCE40 / standard cells | `v2c gatesim opt / ice40 / asic` |
| ✔ Full verification | Run RTL and all three netlists once each and compare |
| Simulation top menu | `--top` (default: all `#[test]`) |

Results of ✔ Full verification:

- All pass: synthesis is correct.
- "A test failed (all implementations agree)": the design itself is wrong.
- "Results differ after synthesis": something went wrong in synthesis, or the design depends on initial values other than power-up 0.

The waveform tab shows all the testbench signals (equivalent to viewing `--vcd` in GTKWave); you can zoom and drag.

## Synthesis flow tab

Three menus in the title bar:

| Menu | Options |
|---|---|
| **Backend** | FPGA, ASIC · vlib, ASIC · SKY130 |
| **Stage** | which step to view (Ctrl/⌘+Shift+B synthesizes and shows the current stage) |

The small box at the top right of the synthesis flow tab takes a **timing target (MHz)** (v2.35), saved in the project: the timing (STA) stages of FPGA and ASIC add a line of slack against that
target (ASIC: WNS, TNS, number of failing endpoints). If the project has a `.sdc` file (timing constraints, syntax in chapter 9), it is used instead and the box greys out showing the filename.
| **Top** | which module to synthesize (same as `--top`) |

| Stage | FPGA | ASIC |
|---|---|---|
| ① RTL→Logic | shared: logic mapped from the Veryl source | |
| ② Logic Netlist | shared: gate-level netlist before optimization | |
| ③ Tech-indep Syn | shared: after optimization (`v2c synth`) | |
| ④ | LUT4 mapping (`SB_LUT4` / `SB_CARRY`…) | standard-cell mapping |
| ⑤ | Placement (annealing animation) | row-based placement (annealing animation) |
| ⑥ | Global and detailed routing | clock tree + global routing |
| ⑦ | Timing (STA) | detailed routing (SKY130 shows each metal layer and DRC) |
| ⑧ | | Timing (STA) |
| ⑨ | | Power + IR drop |

- Breadcrumb bar: switch stage, zoom in / out / fit, toggle wires.
- ⓘ: what this stage does, and its numbers.
- The download buttons depend on the stage:

  | Backend | Downloadable |
  |---|---|
  | FPGA | `.asc`, `.bin` (can be flashed with `iceprog` directly), `.pcf` |
  | ASIC | standard-cell Verilog, DEF |
  | SKY130 | additionally GDSII |

- "⇄ FPGA vs ASIC comparison" puts the area, timing, and power of both backends side by side.

## Machine (🖥)

Some designs don't fit an FPGA and don't suit an ASIC either, e.g. the RV64 SoC with 256 MB of RAM. Such designs are "made real" in a third way:
the "🖥 Machine" button in the title bar uses veryl-emu (`veryl-emu/`, see the source map in chapter 13) to compile the design to WebAssembly and boot it as a machine in a background worker of the browser,
with the UART connected to the terminal in the tab.

- The project needs a `machine.json` describing the top module and what the pins are for:

  ```json
  {
    "top": "Rv64Soc",
    "reset": { "port": "i_rst", "active": 0, "cycles": 2 },
    "uart": { "tx_valid": "o_tx_valid", "tx_data": "o_tx_data", "rx_valid": "i_rx_valid", "rx_data": "i_rx_data", "rx_ready": "o_rx_ready" },
    "finish": { "valid": "o_finish", "code": "o_finish_code", "pass": 21845 },
    "ram": { "array": "mem", "base": "0x80000000" },
    "load": [{ "image": "linux" }]
  }
  ```

  The UART is a handshaked port (one byte per cycle: `tx_data` is sent in the cycle `tx_valid` is high, `rx_data` comes in when `rx_valid` is high);
  writing to the poweroff device (`finish`) ends the run; `load` is the program placed into RAM before boot (a built-in image; ELF loads by its program segment).
- Toolbar: 🖥 Boot (recompile, load, boot), ⏸ / ▶, ⟲ cold boot, 💾 save state, 📂 program (load your own ELF or binary file and boot), plus the cycle count and speed.
- Snapshots (v2.17): at boot, it first looks for the state this project saved in the browser (💾), then the bundled snapshot (`"snapshot"` in `machine.json`, produced by `web/snapshot.mjs`
  at web build time, booted to `"prompt"` and stored as `img_snap_*.js`), and only cold-boots if neither exists; a state only applies to the same compilation result (editing the Veryl forces a cold boot).
  The RV64 board reaches a shell from a snapshot in about 10 seconds (cold boot about 1 minute).
- Files (v2.18): when `machine.json` has `"files": { "addr": "0x8F000000", "size": 16777216 }`, the project's files (everything except Veryl, `machine.json`, and `.pcf`) are placed into the board's `/root`
  at boot (on a cold boot `/init` runs `getfiles`; when booting from a snapshot the IDE types `getfiles` for you); ⇅ Files re-sends them at any time.
  Typing `savefiles` on the board sends `/root` (except hidden files) back to the project: files created or changed on the board appear in the file explorer.
  The RV64 example ships `blink.sh` (blinks the LED on GPIO 5) and `button.sh` (counts button presses): run `sh blink.sh` on the board.
- **MicroPython** (v2.19): the board has MicroPython 1.24 (`micropython`, also `python`; type `micropython` for the REPL, Ctrl-D to leave) and a `pi` module:
  `LED(n)` (`on()`, `off()`, `toggle()`, `value`, `blink()`; n = 0 / 1 is the board's ACT / USER), `Button(n)` (`is_pressed`,
  `wait_for_press()`, `wait_for_release()`; the board's button is 2), `Pin(n, Pin.OUT)`, `sleep`. When a `.py` or `.sh` file is open, the title bar's ▶ becomes
  "▶ Run" (Ctrl/⌘+Enter): it first stops whatever is running on the board (Ctrl-C, plus Ctrl-D in the REPL), sends the project's files into `/root`, then runs
  `micropython <file>` (`.sh` runs `sh <file>`); if the board isn't on it boots first. "▶ Run main.py" on the machine toolbar does the same.
  Examples: `main.py` (the red LED on GPIO 5 and the USER LED take turns), `button.py` (counts button presses), `traffic.py` (red/yellow/green lights on the breadboard at GPIO 5 / 12 / 13,
  with a button on GPIO 6 ending green early).
- **C** (v2.20): a board project can have several `.c` files; open one and press "▶ Run", and the IDE uses veryl-eda's C compiler (`--linux`, see chapter 10) in the browser to
  compile it into an RV64 Linux executable, puts it into `/root` (filename without `.c`) and runs `./<file>`; compile errors appear in the Problems panel. The assembly tab shows the open `.c`.
  Library: `printf`, `delay_ms`, `gpio_write`, `gpio_read`, `pin_mode`, file `open` / `read` / `write`, etc. Examples `blink.c`, `count.c`,
  `lights.c` match the three MicroPython examples. `savefiles` does not send compiled executables back to the project (it only accepts text files).
- **Target menu** (v2.25): the title bar's target menu has two groups: synthesis (FPGA, ASIC · vlib, ASIC · SKY130) and machine (veryl-emu, riscv-emu).
  Choosing a machine opens the machine tab and boots with that engine; choosing synthesis returns to the synthesis flow. The menu follows the tab (showing the machine's engine while on the machine tab),
  and machines this project cannot use are greyed out (no `machine.json`, or riscv-emu when the design is not Rv64Soc). How to choose among the four targets: [chapter 15](15-targets.md).
- **Engine** (v2.23): when `machine.json` has `"riscv": true` (the design is Rv64Soc), the machine toolbar can choose an engine: **riscv-emu** (default) simulates only the instruction set,
  like QEMU — a cold boot reaches a shell in seconds, `sleep(1)` really takes one second (time follows the clock), and the status bar shows MIPS; **veryl-emu** simulates the Veryl hardware itself
  (every cycle, every signal, booted from a snapshot) — choose it to see your own edited Veryl design. GPIO, breadboard, files, ▶ Run, screen, and 💾 work the same on both engines
  (a saved state belongs to the engine that saved it). riscv-emu does not read the project's Veryl source: its SoC is [riscv-emu](../riscv-emu/README.tw.md) written after Rv64Soc.
  Since v2.24 riscv-emu translates hot program blocks to WebAssembly (like QEMU), about 4× faster for long-running programs.
- **Screen** (v2.21): when `machine.json` has `"fb": { "addr": "0x8EF00000", "width": 320, "height": 240 }`, a 320 × 240 screen appears between the board and the breadboard:
  Linux's `simple-framebuffer` (`/dev/fb0`, RGB565) lives in RAM, and the worker checks it every 0.1 s, drawing to the canvas only on change.
  At boot fbcon (tty1) shows a greeting; `echo hi > /dev/tty1` writes text on the screen. MicroPython: `from pi import Screen` is a 320 × 240
  `framebuf` (`fill`, `line`, `rect`, `ellipse`, `text`…, then `show()`), `big_text` for scaled text, `rgb(r, g, b)` for colors;
  C: `fb_clear`, `fb_pixel`, `fb_rect`, `fb_line`, `fb_circle`, `fb_text`, `RGB()` (`/dev/fb0` is mapped at 0x40000000, write it directly to see it).
  Examples: `clock.py` (an analog clock), `shapes.c` (color bars, shapes, text, a bouncing ball).
- The example "RV64 + Linux (machine)" boots OpenSBI + Linux 6.12 + busybox: about 3.7 million cycles per second in the browser, reaching `rv64:~$` in about a minute,
  after which you can type commands in the terminal. The Linux image (`img_linux.js`, about 2.4 MB) loads only on first boot.
- For such projects the top module is too big, so ▶ Test and synthesis instead suggest using the machine (the `Rv64Core` inside can still be synthesized).
- **Board** (v2.16): when `machine.json` has `"gpio": { "out": "o_gpio", "oe": "o_gpio_oe", "in": "i_gpio" }` and `"board": "pi"`,
  a Raspberry-Pi-like board is drawn next to the terminal: a 40-pin header (GPIO 3–15 at the same BCM positions as a Raspberry Pi), a PWR LED, ACT (GPIO 0, Linux's heartbeat)
  and USER (GPIO 1) LEDs, a button (GPIO 2, held = 1), and below it the same breadboard as the virtual iCEBreaker (wired to the header's GPIO 3–15, 3V3, GND).
  The breadboard layout is saved in the project.
  **Keyboard** (v2.30): click the board or the screen (a blue outline appears), and the keyboard can press the buttons: ← or Space = the leftmost button on the breadboard, → = the second,
  ↑ ↓ = the third and fourth, 1–9 in order, B = the board's BTN (GPIO 2); the line under the board lists which key maps to which GPIO. Click the terminal to go back to typing.
  Each key press is held at least 0.12 s, so programs that read the buttons only every few tens of milliseconds don't miss them. Try:

  ```sh
  echo 1 > /sys/class/leds/user/brightness          # USER LED
  B=$(cat /sys/class/gpio/gpiochip*/base)
  echo $((B+5)) > /sys/class/gpio/export; echo out > /sys/class/gpio/gpio$((B+5))/direction
  echo 1 > /sys/class/gpio/gpio$((B+5))/value       # LED on the breadboard (wired to GPIO 5)
  echo $((B+2)) > /sys/class/gpio/export; cat /sys/class/gpio/gpio$((B+2))/value   # hold the board's button and read
  ```
- On a phone the 256 MB of memory may fail to allocate; the machine's buttons live under ⋯ in the phone layout.

## C programs

When the project has a `.c` file:

- "C: view assembly" in the command menu opens the assembly tab (same as `v2c cc -S`).
- "C: run on the instruction-set simulator" prints the serial output to the Output panel (same as `v2c cc --run`; you can enter the text to feed the program first).
- ⚡ Virtual board compiles and loads the C automatically (chapter 12).

## Keyboard

| Key | Action |
|---|---|
| Ctrl/⌘+Enter | Run the test |
| Ctrl/⌘+Shift+B | Synthesize and show the current stage |
| Ctrl/⌘+Shift+P | Command menu (every action is in there) |
| Ctrl/⌘+P | Quick open: projects, examples, files |
| Ctrl/⌘+S | Save (in fact it saves all the time) |
| Ctrl/⌘+J | Collapse / expand the panels |
| Tab / Shift+Tab | Indent / unindent |

## Example library

| Category | Examples |
|---|---|
| Tutorial | Blinky, Knight rider, UART echo (`tutorial/`) |
| Labs | Button counter, traffic-light state machine, breadboard logic gates (used by `tutorial/labs.tw.md`) |
| Basics | Adder, package + enum, generate, function |
| Sequential | Counter, state machine, RAM, block RAM, FIFO, struct, seven-segment display |
| Peripherals | UART, VGA |
| RV64 board | Linux + MicroPython + C + screen (machine); knight rider, reaction-time game, breathing LED, snake, Tetris, system monitor, Linux command intro |
| RISC-V | Single-cycle RV32I, RISC-V SoC |
| C programs | The 8 programs in `examples/c/` on `RvBoard` |
| Mixed | Carry chain, multiple block RAMs, a grab-bag of language features |

The filter buttons above the example library (All, 🧪, ⚡, 🖥, ⚙, with counts) show only examples that can do that thing; the choice is remembered in the browser, and the welcome page's cards set it too.
The icons next to an example say what it can do: 🧪 has tests, ⚡ can go on the virtual board, 🖥 is a machine; the framed one is the suggested first step.
For each example's description, files, and command-line runs, see chapter 16, "[Example catalogue](16-examples.md)".

## URL parameters

Parameters can follow the `#` in the URL, joined with `&`, handy in course materials:

| Parameter | Effect |
|---|---|
| `ex=ID` | Open an example (e.g. `ex=tut_blinky`; if already open, switches to that project) |
| `run=1` | Run the test after opening |
| `verify=1` | Run full verification |
| `stage=KEY` | Synthesize and show a stage: `rtl raw opt map place route sta` (FPGA), `amap aplace aroute adetail asta apower` (ASIC) |
| `pdk=sky130` | Use SKY130 for ASIC |
| `board=1` | Flash to the virtual board |
| `lab=…` | Import a shared lab (chapter 12) |

Example: `index.html#ex=tut_knight&board=1`, `index.html#ex=fifo&stage=adetail&pdk=sky130`.
Example IDs are in `web/build.mjs`.

## Demo page

`demo.html` is the original single-page demo (Traditional Chinese): pick an example, simulate, and the synthesis flow is shown as a full-screen overlay. A subset of the IDE's features.
