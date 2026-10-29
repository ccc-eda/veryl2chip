# 2. Installation

## No Installation: the Online Version

Open <https://ccc-eda.github.io/veryl2chip/web/dist/index.html> for the full IDE (Chapter 11).
It needs no server: after downloading the whole `web/dist/` directory, opening `index.html` directly in the browser also works offline.

## Installing `v2c`

Requires Rust (<https://rustup.rs>):

```sh
cargo install veryl2chip-eda
v2c version
```

This installs `v2c`, plus the older `veryl-eda` command. If you also want the standalone simulator command `veryl-sim`, install `veryl2chip-sim` as well
(`v2c sim` already includes the simulator, so this is usually unnecessary).

## Building from Source

```sh
git clone https://github.com/ccc-eda/veryl2chip
cd veryl2chip
./build.sh            # Rust tools (release) and web/dist; --no-web builds only the Rust tools
```

The built commands are in `veryl-eda/target/release/v2c`. You can add this directory to `PATH`, or run from within `veryl-eda/` with
`cargo run --release --bin v2c -- ...`. Building the web page requires the wasm32 target and Node.js (`build.sh` installs the target and npm packages automatically).

## External Tools (as needed)

| Tool | Purpose | Where it comes from |
|---|---|---|
| `iceprog` | Flash a `.bin` onto a physical iCEBreaker | [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases) |
| `nextpnr-ice40`, `icepack` | The default place & route tools for `v2c fpga` (not needed with `--pnr veryl`) | OSS CAD Suite |
| `nextpnr-ecp5`, `ecppack`, `openFPGALoader` | Place & route, bitstream and flashing for ECP5 (`v2c fpga --arch ecp5`) | OSS CAD Suite |
| IceStorm's `chipdb-5k.txt` | The chip database needed by `--pnr veryl` (its own place & route) | OSS CAD Suite's `share/icebox/`; or point to it with `VERYL_EDA_CHIPDB` |
| `gtkwave` | View waveforms produced by `v2c sim --vcd` | OSS CAD Suite or system packages |
| The official `veryl` | `veryl check` / `veryl test` / `veryl build` (the ground truth for syntax) | `cargo install veryl` |
| KLayout | View `.gds` chip layouts; `tools/gds_check.py` uses its Python module | <https://www.klayout.de>, Python module: `pip install klayout` |
| Full SKY130 files | Only needed by `v2c pdk` and `--pdk sky130:dir` (`--pdk sky130` uses the bundled subset) | Downloaded by `tools/sky130.sh` |

Most things work without OSS CAD Suite: simulation, synthesis, `v2c fpga --pnr veryl` (as long as the chip database is available), the ASIC flow, C programs.

## Environment Variables

| Variable | Purpose |
|---|---|
| `VERYL_EDA_CHIPDB` | Path to IceStorm's `chipdb-5k.txt` (used by its own place & route) |
| `VERYL_EDA_SKY130` | Directory of the full SKY130 hd files (`v2c pdk`) |
| `VERYL_EDA_PROFILE` | When set, prints the timing of each ASIC flow step and the conflict count per detailed-routing round |
| `YOSYS_SLANG`, `GDS_PY` | Used by the developer verification scripts (Chapter 13) |
