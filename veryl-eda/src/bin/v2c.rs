//! `v2c`: veryl2chip's one command, git style: `v2c <subcommand> [options] FILE...`.
//! The subcommands run the simulator (veryl-sim) and the synthesis / FPGA /
//! ASIC / C tools (veryl-eda); `veryl-sim` and `veryl-eda` stay as they are.

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// (name, one-line summary, help text)
const COMMANDS: &[(&str, &str, &str)] = &[
    ("sim", "run the #[test] testbenches (simulation)", "\
usage: v2c sim [--top MODULE] [--vcd FILE.vcd] [--max-time N] FILE.veryl...

Simulates the testbenches: every module with #[test(...)] (or --top MODULE; with no
#[test] module, the last module). $assert failures make the exit code 1.
  --top MODULE      simulate this module (alias -s)
  --vcd FILE.vcd    write the waveforms (one file per testbench: FILE_<top>.vcd)
  --max-time N      stop at simulation time N (default 1000000)
example: v2c sim --vcd wave.vcd counter.veryl"),
    ("list", "list the modules (and which are #[test])", "\
usage: v2c list FILE.veryl...

Prints every module, marking the #[test] testbenches."),
    ("synth", "synthesize to a gate netlist (yosys JSON / Verilog)", "\
usage: v2c synth [--top MODULE] [-o OUT.json] [--verilog OUT.v] FILE.veryl...

Synthesizes MODULE (default: the last non-#[test] module) into a flat gate-level netlist
of yosys internal cells, optimizes it and prints its statistics.
  --top MODULE      the module to synthesize (alias -s)
  -o OUT.json       yosys JSON (alias --json)
  --verilog OUT.v   structural Verilog
example: v2c synth -o adder.json adder.veryl"),
    ("fpga", "FPGA flow (iCE40UP5K, ECP5): LUT mapping, place & route, bitstream", "\
usage: v2c fpga [--top MODULE] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]
                [--pnr veryl|nextpnr] [--seed N] [--no-timing-driven] [--program PROG.bin]
                [-o OUT.json] [--verilog OUT.v] FILE.veryl...
       v2c fpga --arch ecp5 [--device 12k|25k|45k|85k] [--package CABGA381] [--lpf PINS.lpf]
                [--config OUT.config] [--bit OUT.bit] [--seed N] [-o OUT.json] [-v] FILE.veryl...

iCE40 (the default, --arch ice40): maps to SB_LUT4 / SB_CARRY / SB_DFF* / SB_RAM40_4K; with
--asc or --bin, places and routes (nextpnr-ice40, or veryl-eda's own with --pnr veryl) and
writes the bitstream.
  --pcf PINS.pcf          pin constraints (iCEBreaker pins)
  --asc OUT.asc           routed configuration (IceStorm text format)
  --bin OUT.bin           bitstream for iceprog (the own P&R writes it without icepack)
  --pnr veryl|nextpnr     place & route tool (default nextpnr)
  --seed N                placement seed
  --no-timing-driven      wirelength-only placement and routing (own P&R)
  --program PROG.bin      put a program into the block RAMs (e.g. RvBoard, see v2c cc)
  --device up5k --package sg48   (the defaults)
ECP5 (--arch ecp5): maps to LUT4 / CCU2C / TRELLIS_FF; with --config or --bit, places and
routes with nextpnr-ecp5 (default --device 85k --package CABGA381: the ULX3S) and packs the
bitstream with ecppack.
  --lpf PINS.lpf          pin constraints (LOCATE COMP / IOBUF PORT)
  --config OUT.config     routed configuration (Trellis text format)
  --bit OUT.bit           bitstream (openFPGALoader / ecpprog)
examples: v2c fpga --pnr veryl --pcf icebreaker.pcf --bin blinky.bin blinky.veryl
          v2c fpga --arch ecp5 --lpf ulx3s.lpf --bit blinky.bit blinky.veryl"),
    ("asic", "ASIC flow: standard cells, place, route, timing, power (vlib or SKY130)", "\
usage: v2c asic [--top MODULE] [--pdk vlib|sky130|sky130:DIR] [--seed N]
                [--verilog OUT.v] [--def OUT.def] [--gds OUT.gds] [--map-only] [-v] FILE.veryl...

Maps to standard cells, places them in rows, builds the clock tree and power grid, routes
(global and detailed), and reports timing, power and (a PDK) the design rule check.
  --pdk vlib              the built-in educational library (default)
  --pdk sky130            SkyWater SKY130 sky130_fd_sc_hd (the cells come with veryl-eda)
  --pdk sky130:DIR        SKY130 from a full PDK directory (see v2c pdk)
  --verilog OUT.v         netlist with the library's cell names and cell models
  --def OUT.def           placement and routing (DEF)
  --gds OUT.gds           layout as GDSII (SKY130)
  --map-only              only the technology mapping (a netlist for --verilog)
  -v                      details (critical path, DRC examples)
example: v2c asic --pdk sky130 --gds alu.gds --def alu.def alu.veryl"),
    ("gatesim", "run the testbenches on the synthesized netlist", "\
usage: v2c gatesim opt|ice40|ecp5|asic|sky130 [--top MODULE] FILE.veryl...

Post-synthesis simulation: MODULE (default: the last non-#[test] module) is replaced by its
synthesized netlist (opt: generic gates, ice40: LUTs / block RAM, ecp5: ECP5 LUTs / carries,
asic: vlib cells, sky130: SKY130 cells) and its #[test] testbenches run against it.
example: v2c gatesim ice40 fifo.veryl"),
    ("cc", "compile C (or assemble .s) for the RISC-V SoC, run it", "\
usage: v2c cc PROG.c [-o PROG.bin] [-S PROG.s] [-L PROG.lst] [--run [N]] [--mem BYTES]

Compiles a C program (a C subset, with veryl-eda's runtime: printf, LED, UART, timer,
interrupts, atomics, VGA text) for RvSoc (examples/src/rvsoc.veryl); a .s / .S file is
assembled. --run runs it on the instruction-set simulator (N instructions, default 10 M),
printing what it sends to the UART.
  -o PROG.bin     the binary (load it with v2c fpga --program)
  -S PROG.s       the generated assembly
  -L PROG.lst     listing with addresses and source lines
  --mem BYTES     RAM size (default 8192)
example: v2c cc --run examples/c/hello.c"),
    ("pdk", "check a SKY130 PDK directory (Liberty + LEF)", "\
usage: v2c pdk [check] [DIR]

Reads sky130_fd_sc_hd__tt_025C_1v80.lib, sky130_fd_sc_hd.tlef and sky130_fd_sc_hd_merged.lef
from DIR (default: $VERYL_EDA_SKY130, /Users/Shared/ccc/sky130hd, ~/sky130hd; tools/sky130.sh
downloads them) and prints the layers and the cell bindings the ASIC flow uses."),
    ("version", "print the version", "usage: v2c version"),
    ("help", "help on a subcommand", "usage: v2c help [SUBCOMMAND]"),
];

fn help(cmd: Option<&str>) -> ! {
    match cmd.and_then(|c| COMMANDS.iter().find(|x| x.0 == c)) {
        Some((_, _, text)) => println!("{}", text),
        None => {
            if let Some(c) = cmd { eprintln!("v2c: no subcommand '{}'\n", c); }
            println!("v2c {} -- veryl2chip: Veryl HDL to chip (simulation, synthesis, FPGA, ASIC)\n", VERSION);
            println!("usage: v2c <subcommand> [options] FILE.veryl...\n");
            for (n, s, _) in COMMANDS { println!("  {:9} {}", n, s); }
            println!("\n'v2c help <subcommand>' (or 'v2c <subcommand> -h') shows its options.");
            println!("examples: v2c sim counter.veryl     v2c fpga --pnr veryl --pcf pins.pcf --bin top.bin top.veryl");
            if cmd.is_some() { std::process::exit(2); }
        }
    }
    std::process::exit(0)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().map(|s| s.as_str()) else { help(None) };
    let rest: Vec<String> = args[1..].to_vec();
    if rest.iter().any(|a| a == "-h" || a == "--help") { help(Some(cmd)); }
    // argument errors in the tools point back to `v2c help <subcommand>`
    let name: &'static str = COMMANDS.iter().find(|x| x.0 == cmd).map(|x| x.0).unwrap_or("help");
    let _ = veryl_sim::cli::V2C.set(name);
    let _ = veryl_eda::cli::V2C.set(name);
    let with = |flag: &[&str]| -> Vec<String> { flag.iter().map(|s| s.to_string()).chain(rest.iter().cloned()).collect() };
    match cmd {
        "sim" | "test" => veryl_sim::cli::main(&rest),
        "list" => veryl_sim::cli::main(&with(&["--list"])),
        "synth" => veryl_eda::cli::main(rest),
        "fpga" => {
            // --arch ice40 (default) | ecp5
            let mut arch = "ice40".to_string();
            let mut a = vec![];
            let mut it = rest.iter();
            while let Some(x) = it.next() {
                if x == "--arch" { arch = it.next().cloned().unwrap_or_default(); } else { a.push(x.clone()); }
            }
            let flag = match arch.as_str() { "ice40" => "--ice40", "ecp5" => "--ecp5", o => { eprintln!("v2c fpga: --arch is ice40 or ecp5, not '{}'", o); std::process::exit(2) } };
            a.insert(0, flag.to_string());
            veryl_eda::cli::main(a)
        }
        "asic" => veryl_eda::cli::main(with(&["--asic"])),
        "gatesim" => {
            let Some(kind) = rest.first() else { help(Some("gatesim")) };
            if !matches!(kind.as_str(), "opt" | "ice40" | "ecp5" | "asic" | "sky130") { eprintln!("v2c gatesim: the netlist is opt, ice40, ecp5, asic or sky130, not '{}'", kind); std::process::exit(2); }
            let mut a = vec!["--gatesim".to_string(), kind.clone()];
            a.extend(rest[1..].iter().cloned());
            veryl_eda::cli::main(a)
        }
        "cc" => veryl_eda::cli::main(with(&["--cc"])),
        "pdk" => {
            let dir: Vec<String> = rest.iter().filter(|a| *a != "check").cloned().collect();
            let mut a = vec!["--pdk-check".to_string()];
            a.extend(dir);
            veryl_eda::cli::main(a)
        }
        "version" | "--version" | "-V" => println!("v2c {} (veryl2chip-sim, veryl2chip-eda)", VERSION),
        "help" | "-h" | "--help" => help(rest.first().map(|s| s.as_str())),
        c => help(Some(c)),
    }
}
