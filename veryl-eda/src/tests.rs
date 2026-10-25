//! Synthesize the examples and run their testbench scenarios on the
//! gate-level netlist (`cargo test --release`).

use crate::elab::{synthesize, Lib};
use crate::netlist::Netlist;
use crate::netsim::NetSim;
use veryl_parser::Parser;

fn synth(file: &str, top: &str) -> Netlist {
    let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), file);
    let src = std::fs::read_to_string(&path).unwrap();
    let p = Parser::parse(&src, &path).unwrap();
    let mut lib = Lib::new();
    lib.add(&p.veryl);
    synthesize(&lib, top).unwrap_or_else(|e| panic!("{}: {}", top, e)).0
}

/// release the (active-low) reset after one clock in reset
fn reset(s: &mut NetSim, rst: &str) {
    s.set(rst, 0);
    s.step();
    s.set(rst, 1);
}

#[test]
fn adder_exhaustive() {
    let nl = synth("adder.veryl", "Adder");
    let mut s = NetSim::new(&nl);
    for a in 0..256u128 {
        for b in (0..256u128).step_by(7) {
            s.set("i_a", a);
            s.set("i_b", b);
            assert_eq!(s.get("o_s"), (a + b) & 0xff, "{} + {}", a, b);
        }
    }
}

#[test]
fn max3() {
    let nl = synth("max3.veryl", "Max3");
    let mut s = NetSim::new(&nl);
    for (a, b, c) in [(5, 9, 2), (42, 9, 17), (1, 2, 3), (255, 0, 255), (7, 7, 7)] {
        s.set("i_a", a);
        s.set("i_b", b);
        s.set("i_c", c);
        assert_eq!(s.get("o_m"), a.max(b).max(c));
    }
}

#[test]
fn alu_pkg() {
    let nl = synth("alu_pkg.veryl", "AluUnit");
    let mut s = NetSim::new(&nl);
    for (a, b) in [(10u128, 20u128), (200, 100), (0xf0, 0x3c)] {
        s.set("i_a", a);
        s.set("i_b", b);
        let want = [(a + b) & 0xff, a.wrapping_sub(b) & 0xff, a & b, a | b];
        for (op, w) in want.iter().enumerate() {
            s.set("i_op", op as u128);
            assert_eq!(s.get("o_y"), *w, "op {}", op);
        }
    }
}

#[test]
fn gen_rev_and_gray() {
    let nl = synth("gen_rev.veryl", "BitRev");
    let mut s = NetSim::new(&nl);
    for x in 0..16u128 {
        s.set("i_x", x);
        assert_eq!(s.get("o_y"), (0..4).fold(0, |acc, i| acc | (((x >> i) & 1) << (3 - i))));
    }
    let nl = synth("gen_rev.veryl", "GrayConv");
    let mut s = NetSim::new(&nl);
    for b in 0..16u128 {
        s.set("i_bin", b);
        assert_eq!(s.get("o_gray"), b ^ (b >> 1));
    }
}

#[test]
fn seq101() {
    let nl = synth("seq101.veryl", "Seq101");
    let mut s = NetSim::new(&nl);
    reset(&mut s, "i_rst");
    let mut hits = vec![];
    for bit in [1, 0, 1, 0, 1, 1, 0, 1] {
        s.set("i_sig", bit);
        hits.push(s.get("o_hit"));
        s.step();
    }
    assert_eq!(hits, vec![0, 0, 1, 0, 1, 0, 0, 1]);
}

#[test]
fn pkt_reg() {
    let nl = synth("pkt_reg.veryl", "PktReg");
    let mut s = NetSim::new(&nl);
    reset(&mut s, "i_rst");
    assert_eq!(s.get("o_q"), 0);
    // packed struct: valid is the MSB, data the low byte
    s.set("i_d", 1 << 8 | 0xab);
    s.step();
    assert_eq!(s.get("o_q"), 1 << 8 | 0xab);
    s.set("i_d", 0xff);
    s.step();
    assert_eq!(s.get("o_q"), 0xff);
}

#[test]
fn ram() {
    let nl = synth("ram.veryl", "Ram");
    let mut s = NetSim::new(&nl);
    reset(&mut s, "i_rst");
    s.set("i_we", 1);
    for (a, d) in [(3, 0x5a), (12, 0xc3), (0, 0x11)] {
        s.set("i_addr", a);
        s.set("i_wdata", d);
        s.step();
    }
    s.set("i_we", 0);
    for (a, d) in [(3, 0x5a), (12, 0xc3), (0, 0x11), (7, 0)] {
        s.set("i_addr", a);
        assert_eq!(s.get("o_rdata"), d, "addr {}", a);
    }
}

/// the program from TestRiscvCore: x1 = 10, x2 = 20, x3 = x1 + x2, sw x3, 0(x0)
#[test]
fn rv32i_core() {
    let nl = synth("rv32i.veryl", "RiscvCore");
    let mut s = NetSim::new(&nl);
    let rom = |pc: u128| match pc & 0xff { 0x00 => 0x00a00093, 0x04 => 0x01400113, 0x08 => 0x002081b3, 0x0c => 0x00302023, _ => 0x00000013 };
    let mut dmem = [0u128; 16];
    s.set("i_rst", 0);
    s.set("i_imem_inst", rom(0));
    s.step();
    s.set("i_rst", 1);
    for _ in 0..10 {
        s.set("i_imem_inst", rom(s.get("o_imem_addr")));
        s.set("i_dmem_rdata", dmem[((s.get("o_dmem_addr") >> 2) & 15) as usize]);
        if s.get("o_dmem_we") == 1 { dmem[((s.get("o_dmem_addr") >> 2) & 15) as usize] = s.get("o_dmem_wdata"); }
        s.step();
    }
    assert_ne!(s.get("o_imem_addr"), 0, "PC should have advanced");
    assert_eq!(dmem[0], 30, "10 + 20 = 30 should be stored");
}

#[test]
fn rv32i_alu_slt_is_signed() {
    let nl = synth("rv32i.veryl", "Alu");
    let mut s = NetSim::new(&nl);
    s.set("i_op", 4); // Slt
    for (a, b) in [(-1i32, 1i32), (1, -1), (-5, -3), (3, 3), (i32::MIN, i32::MAX)] {
        s.set("i_a", a as u32 as u128);
        s.set("i_b", b as u32 as u128);
        assert_eq!(s.get("o_res"), (a < b) as u128, "{} < {}", a, b);
    }
    s.set("i_op", 1); // Sub
    s.set("i_a", 7);
    s.set("i_b", 7);
    assert_eq!((s.get("o_res"), s.get("o_zero")), (0, 1));
}
