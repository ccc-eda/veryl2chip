#!/usr/bin/env bash
# Rv64Soc for veryl-emu: build the compiler (veryl-emu/, Rust) and compile the design to
# WebAssembly: build/emu/rv64soc.wasm + .json (signal offsets). Run it with emu/rv64emu.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd ../../veryl-emu && cargo build --release -q)
mkdir -p build/emu
../../veryl-emu/target/release/veryl-emu --top Rv64Soc --stop o_tx_valid,o_finish,o_ret \
    -o build/emu/rv64soc.wasm src/rv64core.veryl src/rv64soc.veryl
