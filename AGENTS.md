# AGENTS.md

EDA for Veryl HDL. Root has no build system; the real code lives in `veryl-sim/` (Rust crate, workspace root is `veryl-sim/`, not the repo root).

## Commands

```sh
cd veryl-sim
cargo build --release
./test.sh                          # runs examples/counter.veryl through the simulator
cargo run --release -- [--top MODULE] [--vcd out.vcd] [--max-time N] [--list] a.veryl ...
```

- Always use `--release`; simulation performance matters.
- Default top: all modules with a `#[test(...)]` attribute; if none, the last declared module. `--list` shows modules and which are tests.
- Exit code 1 on assertion failure; `--vcd` writes GTKWave-viewable waveforms.
- Official `veryl` CLI 0.22.0 is installed (`~/.cargo/bin/veryl`, see `install.md`). Run `veryl check` (from `examples/`, which has Veryl.toml) as the syntax/semantic ground truth; `veryl-sim` is a deliberately smaller simulator and its "not supported" errors are not language errors.

## Veryl 0.22.0 quirks (verified against `veryl check`/`veryl test`)

- Bare `<` / `>` in expressions inside `function` bodies break the parser (generic scanner); use `<=` / `>=` / `<:` / `>:` instead.
- Enum members are `Pkg::EnumName::Member`, not `Pkg::Member`.
- `bit` is a reserved keyword — cannot be an identifier.
- Canonical testbench: `inst clk: $tb::clock_gen;` (the inst IS the clock), `inst rst: $tb::reset_gen(clk);`, then `initial { rst.assert(); clk.next(n); $assert(...); }`. Do not hand-toggle a `var clk: clock`.
- `veryl check` warns `missing_reset_statement` for un-reset RAMs/arrays; silence with `#[allow(missing_reset_statement)]` on the `always_ff`.

## Architecture (veryl-sim)

Parses Veryl source with the crates.io `veryl-parser` 0.22 crate (grammar tracking in Veryl.lock/examples). Flow: `main.rs` (CLI, parse, top selection) → `elab.rs` (syntax tree → sim IR, hierarchy/inst expansion) → `sim.rs` (eval, delta cycles, NBA scheduling, clock gen, VCD). `expr.rs` is a Pratt parser over veryl-parser tokens; `value.rs` is 4-state (0/1/x) bit vectors, max 128 bits.

## Limits / gotchas

- Simulator deliberately does NOT support: interfaces, packages, structs/enums, arrays, user functions, generate, `inout`, widths > 128 bit. Don't add examples relying on these.
- Testbench support is via `$tb::clock_gen`, `$tb::reset_gen`, `initial` blocks with `clk.next(n)` / `rst.assert(clk)` — see `veryl-sim/examples/`.
- `examples/` is a separate Veryl project (own Veryl.toml/lock); `_doc/` is currently empty.
- README in veryl-sim is in Traditional Chinese; docs there are authoritative for supported syntax.
