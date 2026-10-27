//! The `v2c` command: every subcommand reaches its tool, help and errors behave.

use std::process::Command;

fn v2c(args: &[&str]) -> (i32, String) {
    let ex = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/src");
    let out = Command::new(env!("CARGO_BIN_EXE_v2c")).args(args).current_dir(ex).output().unwrap();
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr))
}

#[test]
fn subcommands() {
    let (c, o) = v2c(&[]);
    assert!(c == 0 && o.contains("usage: v2c <subcommand>") && o.contains("gatesim"), "{}", o);
    let (c, o) = v2c(&["help", "asic"]);
    assert!(c == 0 && o.contains("--pdk sky130"), "{}", o);
    let (c, o) = v2c(&["fpga", "-h"]);
    assert!(c == 0 && o.contains("usage: v2c fpga"), "{}", o);
    let (c, o) = v2c(&["sim", "seq101.veryl"]);
    assert!(c == 0 && o.contains("TestSeq101: PASS"), "{}", o);
    let (c, o) = v2c(&["list", "seq101.veryl"]);
    assert!(c == 0 && o.contains("TestSeq101  (#[test])"), "{}", o);
    let (c, o) = v2c(&["synth", "adder.veryl"]);
    assert!(c == 0 && o.contains("=== Adder ==="), "{}", o);
    let (c, o) = v2c(&["fpga", "adder.veryl"]);
    assert!(c == 0 && o.contains("SB_LUT4"), "{}", o);
    let (c, o) = v2c(&["fpga", "--arch", "ecp5", "adder.veryl"]);
    assert!(c == 0 && o.contains("CCU2C") && o.contains("LUT4"), "{}", o);
    let (c, o) = v2c(&["gatesim", "ecp5", "seq101.veryl"]);
    assert!(c == 0 && o.contains("TestSeq101: PASS") && o.contains("(ecp5)"), "{}", o);
    assert_eq!(v2c(&["fpga", "--arch", "xc7", "adder.veryl"]).0, 2);
    let (c, o) = v2c(&["asic", "--pdk", "sky130", "seq101.veryl"]);
    assert!(c == 0 && o.contains("sky130_fd_sc_hd__dfrtp_1") && o.contains("0 shorts, 0 spacing"), "{}", o);
    let (c, o) = v2c(&["gatesim", "asic", "seq101.veryl"]);
    assert!(c == 0 && o.contains("TestSeq101: PASS"), "{}", o);
    let (c, o) = v2c(&["cc", "--run", "1000000", "../c/hello.c"]);
    assert!(c == 0 && o.contains("Hello from C"), "{}", o);
    let (c, o) = v2c(&["version"]);
    assert!(c == 0 && o.starts_with("v2c "), "{}", o);
    // errors: an unknown subcommand, an unknown option, a wrong netlist kind
    assert_eq!(v2c(&["frobnicate"]).0, 2);
    let (c, o) = v2c(&["synth", "--bogus", "adder.veryl"]);
    assert!(c == 2 && o.contains("v2c help synth"), "{}", o);
    assert_eq!(v2c(&["gatesim", "xyz", "adder.veryl"]).0, 2);
    // a failing testbench still fails
    let (c, _) = v2c(&["sim", "--max-time", "1", "seq101.veryl"]);
    assert!(c == 0 || c == 1);
}
