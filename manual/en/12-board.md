# 12. Virtual board

You can "flash" without an iCEBreaker: the IDE's ⚡ **Virtual board** draws an iCEBreaker (with the PMOD2 expansion board: 5 LEDs, 3 buttons),
puts your design on it and runs it — buttons can be pressed, LEDs light up, and you can attach a serial terminal, external modules, and a breadboard.
It runs in its own background thread and never blocks the editor.

## Three modes

| Mode | What runs | Speed | When to use |
|---|---|---|---|
| **Bitstream (real)** (default) | synthesis → its own place & route → `.bin`, then the bitstream is **decoded back into a circuit** and simulated cycle by cycle | real time for small designs, slower for large ones | check what would actually be flashed to a real chip (place & route included) |
| **Netlist (fast)** | the iCE40-mapped netlist, without place & route | much faster | editing the design, checking behaviour |
| **CPU (C program, real time)** | the project's `.c` runs on an instruction-set simulator, with the same peripherals, memory map, and cycles per instruction as `RvSoc` | real time at 12 MHz | C programs (the default for the "C programs" example) |

- After flashing, the status bar shows the virtual time and "× real time"; the speed menu can pick "no faster than real time" or "fastest", and you can pause.
- ⟲ Power cycle: start over (all registers back to 0, like a real chip).
- 📂 `.bin` (or drag a file onto the board): loads **any** iCE40UP5K bitstream, e.g. one made by `v2c fpga --bin` or nextpnr + icepack.
- ⬇ .bin downloads the current bitstream, ready to be flashed to a real board with `iceprog`.

Made from the command line and run on the virtual board:

```sh
v2c fpga --pnr veryl --pcf counter.pcf --bin counter.bin counter.veryl
```

Then drag `counter.bin` onto the virtual board.

## Controls

| Action | How |
|---|---|
| Press a button | hold it with the mouse; or keyboard `0` = BTN_N (the board's button), `1`–`3` = BTN1–BTN3 |
| Latch a button | Shift+click (click again to release) |
| Inspect pins | hover over a pin: which port of the design, the current level; pins the design "doesn't use" are marked too |

LED brightness follows the fraction of time lit, so PWM dimming and a multiplex-scanned seven-segment display look just like the real thing.

## Pins: 📌

Which pin each port of the design connects to is decided by the project's `pins.pcf` (format in chapter 7). The 📌 Pins dialog lists every port with a dropdown of pins;
"Apply and flash" writes it back to `pins.pcf` and flashes again. You can also edit `pins.pcf` directly in the editor.

## USB terminal 🖥

Wired to the FPGA's pin 6 (RX, computer → FPGA) and pin 9 (TX, FPGA → computer).

- Type and press Enter to send; what the program sends back appears above.
- Baud-rate menu: clocks per bit = 12 MHz ÷ baud rate. There is also "8 clocks per bit" for test designs (e.g. `UartLoop`).
- A "format error" usually means the baud rate doesn't match the design.

## PMOD modules

PMOD1A and PMOD1B each take one module:

| Module | Wiring |
|---|---|
| 8 LEDs | pins 1–4, 7–10 → LED 0–7 (active high) |
| 8 switches | click to toggle; pins 1–4, 7–10 = switch 0–7 |
| Seven-segment display (2 digits) | pins 1–4, 7–9 = segments a–g, pin 10 = digit select (multiplexed scan) |
| VGA monitor | the PmodVGA wiring, taking 1A + 1B; shows a 640×480 picture |
| Buzzer | a square wave on pin 1; it sounds only with 🔊 checked |

PMOD1A pins: 1–4 = 4, 2, 47, 45, 7–10 = 3, 48, 46, 44; PMOD1B: 1–4 = 43, 38, 34, 31, 7–10 = 42, 36, 32, 28.

## Breadboard 🧪

With 🧪 Breadboard checked, a breadboard appears next to the board, so you can wire the PMOD pins to your own circuit.

- **Parts**: wires, resistors, LEDs, buttons, switches.
- **Placing**: pick a tool, click two holes to place a part (for an LED click the anode first).
- **Deleting**: select then press Delete, or right-click.
- **Operating**: hold buttons, click switches.

It is a simplified circuit model:

- Copper strips, power rails, wires, pressed buttons, and closed switches join holes into the same node.
- Resistors provide a "weak" level (pull-up / pull-down).
- An LED lights when its anode is above its cathode.

Warnings are shown when:

- there is a short circuit (e.g. an FPGA output tied directly to GND);
- an LED has no series current-limiting resistor;
- an input pin floats (add a pull-up or pull-down resistor).

Pins already occupied by a PMOD module cannot be wired to the breadboard.

## Sharing labs

A lab contains the files, `pins.pcf`, modules, and the breadboard. Two ways to share:

- **🔗 Share lab (make a link)**: the whole lab is compressed into the URL (`index.html#lab=…`); whoever opens it imports it as a new project — no server needed.
- **Export the lab file `.lab.json`**: open it with ⇪ Import.

`tutorial/labs.tw.md` is a course of 8 labs using the virtual board; each lab is a `#ex=…&board=1` link.

## Differences from a real board

- Bitstream mode simulates the logic and routing inside the bitstream, **not** analog effects: no glitches from delays, no metastability.
- Timing violations are not simulated: a design with Fmax below 12 MHz still works fine here but wouldn't on a real chip. Check the Fmax printed by `v2c fpga`.
- Buttons don't bounce.
- The board drawing is a schematic, not a picture.
