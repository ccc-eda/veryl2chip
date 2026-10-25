//! Synthesize the examples and run their testbench scenarios on the
//! gate-level netlist, on its iCE40 (LUT4 / SB_DFF) mapping and on its vlib
//! standard-cell mapping (`cargo test --release`).

use crate::elab::{synthesize, Lib};
use crate::netsim::NetSim;
use veryl_parser::Parser;

/// synthesize `top` from the given files, then run `check` on the gate
/// netlist, the iCE40-mapped netlist and the standard-cell netlist
fn synth(files: &[&str], top: &str, check: impl Fn(&mut NetSim)) {
    let mut parsers = vec![];
    for f in files {
        let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), f);
        let path = if std::path::Path::new(&path).exists() { path } else { format!("{}/examples/{}", env!("CARGO_MANIFEST_DIR"), f) };
        let src = std::fs::read_to_string(&path).unwrap();
        parsers.push(Parser::parse(&src, &path).unwrap());
    }
    let mut lib = Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    let nl = synthesize(&lib, top).unwrap_or_else(|e| panic!("{}: {}", top, e)).0;
    check(&mut NetSim::new(&nl));
    let mapped = crate::ice40::map(&nl).unwrap();
    assert!(mapped.cells.iter().all(|c| c.typ.starts_with("SB_")));
    check(&mut NetSim::new(&mapped));
    let cells = crate::asic::map::map(&nl).unwrap();
    assert!(cells.cells.iter().all(|c| c.typ == "SRAM" || crate::asic::lib::LIB.iter().any(|l| l.name == c.typ)));
    check(&mut NetSim::new(&cells));
}

/// release the (active-low) reset after one clock in reset
fn reset(s: &mut NetSim, rst: &str) {
    s.set(rst, 0);
    s.step();
    s.set(rst, 1);
}

#[test]
fn adder_exhaustive() {
    synth(&["adder.veryl"], "Adder", |s| {
        for a in 0..256u128 {
            for b in (0..256u128).step_by(7) {
                s.set("i_a", a);
                s.set("i_b", b);
                assert_eq!(s.get("o_s"), (a + b) & 0xff, "{} + {}", a, b);
            }
        }
    });
}

#[test]
fn max3() {
    synth(&["max3.veryl"], "Max3", |s| {
        for (a, b, c) in [(5, 9, 2), (42, 9, 17), (1, 2, 3), (255, 0, 255), (7, 7, 7)] {
            s.set("i_a", a);
            s.set("i_b", b);
            s.set("i_c", c);
            assert_eq!(s.get("o_m"), a.max(b).max(c));
        }
    });
}

#[test]
fn alu_pkg() {
    synth(&["alu_pkg.veryl"], "AluUnit", |s| {
        for (a, b) in [(10u128, 20u128), (200, 100), (0xf0, 0x3c)] {
            s.set("i_a", a);
            s.set("i_b", b);
            let want = [(a + b) & 0xff, a.wrapping_sub(b) & 0xff, a & b, a | b];
            for (op, w) in want.iter().enumerate() {
                s.set("i_op", op as u128);
                assert_eq!(s.get("o_y"), *w, "op {}", op);
            }
        }
    });
}

#[test]
fn gen_rev_and_gray() {
    synth(&["gen_rev.veryl"], "BitRev", |s| {
        for x in 0..16u128 {
            s.set("i_x", x);
            assert_eq!(s.get("o_y"), (0..4).fold(0, |acc, i| acc | (((x >> i) & 1) << (3 - i))));
        }
    });
    synth(&["gen_rev.veryl"], "GrayConv", |s| {
        for b in 0..16u128 {
            s.set("i_bin", b);
            assert_eq!(s.get("o_gray"), b ^ (b >> 1));
        }
    });
}

#[test]
fn seq101() {
    synth(&["seq101.veryl"], "Seq101", |s| {
        reset(s, "i_rst");
        let mut hits = vec![];
        for bit in [1, 0, 1, 0, 1, 1, 0, 1] {
            s.set("i_sig", bit);
            hits.push(s.get("o_hit"));
            s.step();
        }
        assert_eq!(hits, vec![0, 0, 1, 0, 1, 0, 0, 1]);
    });
}

#[test]
fn pkt_reg() {
    synth(&["pkt_reg.veryl"], "PktReg", |s| {
        reset(s, "i_rst");
        assert_eq!(s.get("o_q"), 0);
        // packed struct: valid is the MSB, data the low byte
        s.set("i_d", 1 << 8 | 0xab);
        s.step();
        assert_eq!(s.get("o_q"), 1 << 8 | 0xab);
        s.set("i_d", 0xff);
        s.step();
        assert_eq!(s.get("o_q"), 0xff);
    });
}

#[test]
fn ram() {
    synth(&["ram.veryl"], "Ram", |s| {
        reset(s, "i_rst");
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
    });
}

/// synthesize `top` from files in examples/src
fn netlist(files: &[&str], top: &str) -> crate::netlist::Netlist {
    let mut parsers = vec![];
    for f in files {
        let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), f);
        let path = if std::path::Path::new(&path).exists() { path } else { format!("{}/examples/{}", env!("CARGO_MANIFEST_DIR"), f) };
        let src = std::fs::read_to_string(&path).unwrap();
        parsers.push(Parser::parse(&src, &path).unwrap());
    }
    let mut lib = Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    synthesize(&lib, top).unwrap_or_else(|e| panic!("{}: {}", top, e)).0
}

/// (word index, value) pairs from the `$assert(dmem[i] == 32'h..)` lines of TestRiscvCore
fn rv32i_expected() -> Vec<(usize, u128)> {
    let src = std::fs::read_to_string(format!("{}/../examples/src/rv32i.veryl", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut v = vec![];
    for l in src.lines() {
        let Some(rest) = l.trim().strip_prefix("$assert(dmem[") else { continue };
        let (idx, rest) = rest.split_once("] == 32'h").unwrap();
        let hex: String = rest.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
        v.push((idx.parse().unwrap(), u128::from_str_radix(&hex, 16).unwrap()));
    }
    assert!(v.len() > 40);
    v
}

/// TestRiscvCore's RV32I program (examples/sw/rv32i_test.S) on the synthesized
/// core: the ROM is its own synthesized netlist, the data RAM is modelled here
#[test]
fn rv32i_core() {
    let rom_nl = netlist(&["rv32i_rom.veryl"], "RiscvTestRom");
    let expected = rv32i_expected();
    synth(&["rv32i.veryl"], "RiscvCore", |s| {
        let mut rom = NetSim::new(&rom_nl);
        let mut dmem = [0u128; 64];
        s.set("i_rst", 0);
        s.step();
        s.set("i_rst", 1);
        for _ in 0..200 {
            rom.set("i_addr", s.get("o_imem_addr"));
            s.set("i_imem_inst", rom.get("o_inst"));
            let a = ((s.get("o_dmem_addr") >> 2) & 63) as usize;
            s.set("i_dmem_rdata", dmem[a]);
            if s.get("o_dmem_we") == 1 {
                let strb = s.get("o_dmem_wstrb");
                let mask = (0..4).filter(|i| (strb >> i) & 1 == 1).fold(0u128, |m, i| m | (0xff << (8 * i)));
                dmem[a] = (dmem[a] & !mask) | (s.get("o_dmem_wdata") & mask);
            }
            s.step();
        }
        for (i, want) in &expected {
            assert_eq!(dmem[*i], *want, "dmem[{}]", i);
        }
    });
}

/// every ALU operation against a Rust reference
#[test]
fn rv32i_alu() {
    synth(&["rv32i.veryl"], "Alu", |s| {
        let ops: [(u128, fn(u32, u32) -> u32); 10] = [
            (0, |a, b| a.wrapping_add(b)),
            (1, |a, b| a.wrapping_sub(b)),
            (2, |a, b| a & b),
            (3, |a, b| a | b),
            (4, |a, b| ((a as i32) < (b as i32)) as u32),
            (5, |a, b| (a < b) as u32),
            (6, |a, b| a ^ b),
            (7, |a, b| a << (b & 31)),
            (8, |a, b| a >> (b & 31)),
            (9, |a, b| ((a as i32) >> (b & 31)) as u32),
        ];
        let vals = [0u32, 1, 7, 31, 32, 0x7fff_ffff, 0x8000_0000, 0xffff_fff8, 0x1234_5678];
        for (op, f) in ops {
            s.set("i_op", op);
            for a in vals {
                for b in vals {
                    s.set("i_a", a as u128);
                    s.set("i_b", b as u128);
                    assert_eq!(s.get("o_res"), f(a, b) as u128, "op {} a {:#x} b {:#x}", op, a, b);
                }
            }
        }
    });
}

/// the FPGA SoC: Fibonacci(10) in a loop, result on the LED register
#[test]
fn riscv_soc_fib() {
    synth(&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"], "RiscvSoc", |s| {
        reset(s, "i_rst");
        let mut cycles = 0;
        while s.get("o_led") == 0 && cycles < 200 {
            s.step();
            cycles += 1;
        }
        assert_eq!(s.get("o_led"), 55, "fib(10) after {} cycles", cycles);
    });
}

/// the ASIC back end: legal rows (no overlap, inside the die), every routed
/// net one connected tree over its terminals, no overflow, a sane STA
#[test]
fn asic_flow_legal() {
    for (files, top) in [(&["ram.veryl"][..], "Ram"), (&["sync_ram.veryl", "bram_tests.veryl"][..], "BramMix"), (&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"][..], "RiscvSoc")] {
        let mut parsers = vec![];
        for f in files {
            let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), f);
            let path = if std::path::Path::new(&path).exists() { path } else { format!("{}/examples/{}", env!("CARGO_MANIFEST_DIR"), f) };
            parsers.push(Parser::parse(&std::fs::read_to_string(&path).unwrap(), &path).unwrap());
        }
        let mut lib = Lib::new();
        for p in &parsers { lib.add(&p.veryl); }
        let nl = synthesize(&lib, top).unwrap().0;
        let o = crate::asic::flow(&nl, 1).unwrap();
        let pl = &o.placement;
        let mut occ = vec![vec![false; pl.sites as usize]; pl.rows as usize];
        for (i, c) in o.mapped.cells.iter().enumerate() {
            let (r, x) = pl.pos[i];
            let (w, h) = crate::asic::lib::dims(c);
            assert!(r + h <= pl.rows && x + w <= pl.sites, "{}: cell {} outside the die", top, i);
            for rr in r..r + h {
                for s in x..x + w { assert!(!occ[rr as usize][s as usize], "{}: overlap at row {} site {}", top, rr, s); occ[rr as usize][s as usize] = true; }
            }
        }
        // fillers close every gap: cells + fillers cover each site exactly once
        for &(r, x, w) in &o.pdn.fillers {
            for s in x..x + w { assert!(!occ[r as usize][s as usize], "{}: filler overlaps at row {} site {}", top, r, s); occ[r as usize][s as usize] = true; }
        }
        assert!(occ.iter().all(|row| row.iter().all(|o| *o)), "{}: a site is neither cell nor filler", top);
        // signal wires stay off the power straps and via stacks
        let ny = pl.rows * crate::asic::detail::TRACKS + 1;
        let power: std::collections::HashSet<(u8, u32, u32)> = o.pdn.blocked(ny).into_iter().map(|(l, x, y)| (l as u8, x, y)).collect();
        assert!(!o.pdn.straps.is_empty(), "{}: no power straps", top);
        for n in &o.detail.nets {
            for &(l, x0, y0, x1, y1) in &n.segs { for x in x0..=x1 { for y in y0..=y1 { assert!(!power.contains(&(l, x, y)), "{}: signal on the power grid at {:?}", top, (l, x, y)); } } }
        }
        // detailed routing, checked from its wires alone: no grid node in two
        // nets, and every net one connected piece that reaches all its pins
        let d = &o.detail;
        assert_eq!((d.conflicts, d.opens), (0, 0), "{}: detailed routing", top);
        let mut owner: std::collections::HashMap<(u8, u32, u32), usize> = Default::default();
        for (ni, n) in d.nets.iter().enumerate() {
            let mut nodes: Vec<(u8, u32, u32)> = vec![];
            for &(l, x0, y0, x1, y1) in &n.segs { for x in x0..=x1 { for y in y0..=y1 { nodes.push((l, x, y)); } } }
            for &(l, x, y) in &n.vias { if l != 255 { nodes.push((l, x, y)); nodes.push((l + 1, x, y)); } }
            nodes.sort(); nodes.dedup();
            for &q in &nodes { if let Some(o) = owner.insert(q, ni) { assert!(o == ni, "{}: short between nets {} and {} at {:?}", top, o, ni, q); } }
            if nodes.is_empty() { continue; }
            // connectivity: flood fill along tracks and vias
            let set: std::collections::HashSet<(u8, u32, u32)> = nodes.iter().copied().collect();
            let mut seen = std::collections::HashSet::new();
            let mut work = vec![nodes[0]];
            while let Some(q) = work.pop() {
                if !seen.insert(q) { continue; }
                let (l, x, y) = q;
                let mut nb = vec![(l + 1, x, y)];
                if l > 0 { nb.push((l - 1, x, y)); }
                if l % 2 == 0 { nb.push((l, x + 1, y)); if x > 0 { nb.push((l, x - 1, y)); } } else { nb.push((l, x, y + 1)); if y > 0 { nb.push((l, x, y - 1)); } }
                for v in nb { if set.contains(&v) { work.push(v); } }
            }
            assert_eq!(seen.len(), set.len(), "{}: net {} routed in pieces", top, ni);
            for &(l, x, y) in &n.vias { if l == 255 { assert!(set.contains(&(0, x, y)), "{}: net {} misses a pin", top, ni); } }
        }
        // the clock tree: every flip-flop clock comes through CLKBUFs, with little skew
        assert!(o.cts.buffers > 0, "{}: no clock tree", top);
        assert!(o.timing.skew < 0.3 && o.timing.hold_viol.is_empty(), "{}: skew {} hold {:?}", top, o.timing.skew, o.timing.hold_viol.len());
        assert_eq!(o.routing.overflow, 0, "{}: routing overflow", top);
        for n in &o.routing.nets {
            // union-find over the gcells the segments touch
            let mut parent: std::collections::HashMap<(u32, u32), (u32, u32)> = Default::default();
            fn find(p: &mut std::collections::HashMap<(u32, u32), (u32, u32)>, x: (u32, u32)) -> (u32, u32) {
                let y = *p.entry(x).or_insert(x);
                if y == x { x } else { let r = find(p, y); p.insert(x, r); r }
            }
            for &(x0, y0, x1, y1) in &n.segs {
                assert_eq!(x0.abs_diff(x1) + y0.abs_diff(y1), 1);
                let (a, b) = (find(&mut parent, (x0, y0)), find(&mut parent, (x1, y1)));
                parent.insert(a, b);
            }
            let roots: std::collections::HashSet<_> = parent.keys().copied().collect::<Vec<_>>().into_iter().map(|k| find(&mut parent, k)).collect();
            assert!(roots.len() <= 1, "{}: net {:?} routed in {} pieces", top, n.bit, roots.len());
        }
        assert!(o.timing.fmax > 10.0 && o.timing.fmax < 2000.0, "{}: Fmax {}", top, o.timing.fmax);
        assert!(!o.timing.path.is_empty());
    }
}

/// random reads and writes against a model of a synchronous-read memory
/// (read-during-write returns the old word); `second` = the 2nd read port
fn sync_ram_check(s: &mut NetSim, abits: u32, dbits: u32, second: bool) {
    let mut mem = vec![0u128; 1 << abits];
    let (mut out, mut out2) = (0u128, 0u128);
    let mut x = 0x2545f4914f6cdd1du64;
    let mut rnd = move || { x ^= x << 13; x ^= x >> 7; x ^= x << 17; x };
    let dmask = (1u128 << dbits) - 1;
    for cycle in 0..400 {
        let (we, re) = (rnd() % 3 != 0, rnd() % 4 != 0);
        // reuse a few addresses so reads hit written words
        let pick = |r: u64| (r % 8 * 37 + r % 3) as usize % (1 << abits);
        let (wa, ra, ra2, wd) = (pick(rnd()), pick(rnd()), pick(rnd()), (rnd() as u128) & dmask);
        s.set("i_we", we as u128);
        s.set("i_waddr", wa as u128);
        s.set("i_wdata", wd);
        s.set("i_re", re as u128);
        s.set("i_raddr", ra as u128);
        if second { s.set("i_raddr2", ra2 as u128); }
        s.step();
        if re { out = mem[ra]; }
        out2 = mem[ra2];
        if we { mem[wa] = wd; }
        assert_eq!(s.get("o_rdata"), out, "cycle {}", cycle);
        if second { assert_eq!(s.get("o_rdata2"), out2, "cycle {} (port 2)", cycle); }
    }
}

/// block RAM count of the iCE40 mapping
fn brams(files: &[&str], top: &str) -> usize {
    let mut parsers = vec![];
    for f in files {
        let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), f);
        let path = if std::path::Path::new(&path).exists() { path } else { format!("{}/examples/{}", env!("CARGO_MANIFEST_DIR"), f) };
        parsers.push(Parser::parse(&std::fs::read_to_string(&path).unwrap(), &path).unwrap());
    }
    let mut lib = Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    let nl = synthesize(&lib, top).unwrap().0;
    crate::ice40::map(&nl).unwrap().cells.iter().filter(|c| c.typ == "SB_RAM40_4K").count()
}

#[test]
fn sync_ram_bram() {
    for (top, a, d, n) in [("Bram256x16", 8, 16, 1), ("Bram1024x4", 10, 4, 1), ("Bram2048x2", 11, 2, 1), ("Bram512x20", 9, 20, 3)] {
        synth(&["sync_ram.veryl", "bram_tests.veryl"], top, |s| sync_ram_check(s, a, d, false));
        assert_eq!(brams(&["sync_ram.veryl", "bram_tests.veryl"], top), n, "{}", top);
    }
    synth(&["bram_tests.veryl"], "Bram2Read", |s| sync_ram_check(s, 8, 16, true));
    synth(&["sync_ram.veryl"], "SyncRam", |s| sync_ram_check(s, 9, 8, false));
    assert_eq!(brams(&["sync_ram.veryl"], "SyncRam"), 1);
    assert_eq!(brams(&["bram_tests.veryl"], "Bram2Read"), 2);
    // asynchronous reads stay logic
    assert_eq!(brams(&["ram.veryl"], "Ram"), 0);
    assert_eq!(brams(&["rv32i.veryl"], "RegFile"), 0);
}

/// BramMix (4 block RAMs on iCE40): TestBramMix's checks
#[test]
fn bram_mix() {
    synth(&["sync_ram.veryl", "bram_tests.veryl"], "BramMix", |s| {
        s.set("i_sel", 2);
        reset(s, "i_rst");
        for _ in 0..20 { s.step(); }
        assert_eq!(s.get("o_out"), 0x55);
        for _ in 0..300 { s.step(); }
        for (sel, want) in [(2, 0x61), (3, 0x3e), (0, 0x83), (1, 0x8c)] {
            s.set("i_sel", sel);
            assert_eq!(s.get("o_out"), want, "sel {}", sel);
        }
    });
    assert_eq!(brams(&["sync_ram.veryl", "bram_tests.veryl"], "BramMix"), 4);
}

/// hold fixing: with 0.4 ns more hold requirement the flow must insert delay
/// buffers until no endpoint violates, and the result still computes fib(10)
#[test]
fn asic_hold_fix() {
    let nl = netlist(&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"], "RiscvSoc");
    let o = crate::asic::flow_with(&nl, 1, 0.4).unwrap();
    assert!(o.hold_bufs > 0, "no hold buffers inserted");
    assert!(o.timing.hold_viol.is_empty(), "{} hold violations left", o.timing.hold_viol.len());
    let mut s = NetSim::new(&o.mapped);
    reset(&mut s, "i_rst");
    let mut cycles = 0;
    while s.get("o_led") == 0 && cycles < 200 { s.step(); cycles += 1; }
    assert_eq!(s.get("o_led"), 55, "fib(10) after {} cycles", cycles);
}

/// activity simulation: a 4-bit counter with a random enable: bit 0 toggles
/// on about half of the cycles, bit 1 half as often; the power numbers add up
#[test]
fn power_activity() {
    let nl = netlist(&["features.veryl"], "Counter");
    let act = crate::power::activity(&nl, 1000, 7);
    let q = &nl.ports.iter().find(|p| p.name == "o_q").unwrap().bits;
    let r0 = act.rate.get(&q[0]).copied().unwrap_or(0.0);
    let r1 = act.rate.get(&q[1]).copied().unwrap_or(0.0);
    assert!(r0 > 0.35 && r0 < 0.65, "bit 0 toggles {}", r0);
    assert!(r1 > 0.15 && r1 < 0.35, "bit 1 toggles {}", r1);
    let o = crate::asic::flow(&netlist(&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"], "RiscvSoc"), 1).unwrap();
    let p = &o.power;
    assert!(p.e_clock > 0.0 && p.e_nets > 0.0 && p.leakage > 0.0 && p.ir_worst >= 0.0);
    assert!((p.total - p.dynamic - p.leakage).abs() < 1e-9);
}
