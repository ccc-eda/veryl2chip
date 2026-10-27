//! Synthesize the examples and run their testbench scenarios on the
//! gate-level netlist, on its iCE40 (LUT4 / SB_DFF) and ECP5 mappings and on its vlib
//! standard-cell mapping (`cargo test --release`).

use crate::elab::{synthesize, Lib};
use crate::netsim::NetSim;
use veryl_parser::Parser;

/// synthesize `top` from the given files, then run `check` on the gate
/// netlist, the iCE40- and ECP5-mapped netlists and the standard-cell netlist
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
    let ecp5 = crate::ecp5::map(&nl).unwrap();
    assert!(ecp5.cells.iter().all(|c| matches!(c.typ.as_str(), "LUT4" | "CCU2C" | "TRELLIS_FF" | "DP16KD")));
    check(&mut NetSim::new(&ecp5));
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
fn asic_flow_legal() { asic_legal(&[(&["ram.veryl"][..], "Ram"), (&["sync_ram.veryl", "bram_tests.veryl"][..], "BramMix"), (&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"][..], "RiscvSoc")]); }

/// the same checks with the SKY130 cells: every cell bound to a library cell,
/// pin access from the LEF, the exported names (no SRAM macros in SKY130 yet:
/// memories are flip-flops, so no BramMix)
#[test]
fn asic_flow_legal_sky130() {
    let t = crate::pdk::sky130_builtin().unwrap();
    crate::pdk::with_tech(t.clone(), || asic_legal(&[(&["ram.veryl"][..], "Ram"), (&["rv32i.veryl", "rv32i_rom.veryl", "soc.veryl"][..], "RiscvSoc")]));
}

fn asic_legal(designs: &[(&[&str], &str)]) {
    let tech = crate::pdk::tech();
    for &(files, top) in designs {
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
        if !tech.is_vlib() {
            assert!(o.mapped.cells.iter().all(|c| tech.binding(&c.typ).is_some()), "{}: a cell without a {} binding", top, tech.name);
            let v = crate::output::to_verilog(&crate::pdk::to_library(&o.mapped));
            assert!(v.contains("sky130_fd_sc_hd__") && !v.contains(" DFF") && !v.contains(" NAND2 "), "{}", top);
            // the DEF read back against the LEF: cells on the unithd rows, no overlaps, every site covered
            let def = crate::pdk::def::parse(&crate::asic::def(&o)).unwrap();
            let bad = crate::pdk::def::check_placement(&def, tech.lef.as_ref().unwrap());
            assert!(bad.is_empty(), "{}: {:?}", top, &bad[..bad.len().min(5)]);
            assert_eq!(def.comps.len(), o.mapped.cells.len() + def.comps.iter().filter(|c| c.name.starts_with("fill") || c.name.starts_with("tap")).count());
            assert!(!o.pdn.taps.is_empty() && o.pdn.tap_viol == 0, "{}: {} taps, {} sites too far from one", top, o.pdn.taps.len(), o.pdn.tap_viol);
            assert!(def.nets.iter().any(|n| n.routes.iter().any(|r| matches!(r, crate::pdk::def::Route::Via { via, .. } if via == "L1M1_PR"))));
            // the layout with the cells' own shapes: design rules from the tech LEF
            let l = crate::asic::layout::build(&o).unwrap();
            let d = crate::asic::drc::check(&l, &o.mapped);
            assert_eq!((d.shorts, d.spacing, d.area, d.opens), (0, 0, 0, 0), "{}: DRC {:?}", top, d.details);
            // GDS: the cells used and a top structure placing each instance (SREF) with the routing (BOUNDARY)
            let g = crate::asic::gds::write(&l, &o.mapped.name, crate::pdk::SKY130_GDS).unwrap();
            let st = crate::asic::gds::structures(&g);
            let topst = &st[&o.mapped.name];
            let count = |rt: u8| { let (mut i, mut n) = (0, 0); while i + 4 <= topst.len() { let len = u16::from_be_bytes([topst[i], topst[i + 1]]) as usize; if topst[i + 2] == rt { n += 1; } i += len.max(4); } n };
            assert_eq!(count(0x0A), l.insts.len(), "{}: SREFs", top);
            assert_eq!(count(0x08), l.shapes.len() + l.labels.len(), "{}: boundaries", top);
            assert!(l.insts.iter().all(|i| st.contains_key(&i.cell)));
        }
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
        assert!(pl.max_density < (pl.target_density + 0.25).max(0.98), "{}: a bin is {:.0}% full", top, pl.max_density * 100.0);
        // fillers close every gap: cells + fillers cover each site exactly once
        for &(r, x, w) in &o.pdn.fillers {
            for s in x..x + w { assert!(!occ[r as usize][s as usize], "{}: filler overlaps at row {} site {}", top, r, s); occ[r as usize][s as usize] = true; }
        }
        let tw = tech.tap.as_ref().map(|t| t.1).unwrap_or(1);
        for &(r, x) in &o.pdn.taps {
            for s in x..x + tw { assert!(!occ[r as usize][s as usize], "{}: tap overlaps at row {} site {}", top, r, s); occ[r as usize][s as usize] = true; }
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

/// non-constant division: every 8-bit pair against Rust (x / 0 is x in SV)
#[test]
fn division() {
    synth(&["lang.veryl"], "Div", |s| {
        for a in 0..256u32 {
            for b in 1..256u32 {
                s.set("i_a", a as u128);
                s.set("i_b", b as u128);
                let (sa, sb) = (a as u8 as i8, b as u8 as i8);
                assert_eq!(s.get("o_q"), (a / b) as u128, "{} / {}", a, b);
                assert_eq!(s.get("o_r"), (a % b) as u128, "{} % {}", a, b);
                assert_eq!(s.get("o_sq"), sa.wrapping_div(sb) as u8 as u128, "{} / {} signed", sa, sb);
                assert_eq!(s.get("o_sr"), sa.wrapping_rem(sb) as u8 as u128, "{} % {} signed", sa, sb);
            }
        }
    });
}

/// an interface between two modules (modports, a `let` inside the
/// interface): TestHs's result on every netlist
#[test]
fn interface_handshake() {
    synth(&["lang.veryl"], "HsTop", |s| {
        reset(s, "i_rst");
        for _ in 0..20 { s.step(); }
        assert_eq!(s.get("o_sum"), 145);
    });
}

/// modport defaults: ..converse / ..same / ..input / ..output
#[test]
fn modport_defaults() {
    let src = "interface I {\n var a: logic;\n var b: logic;\n var c: logic;\n modport m { a: output, b: input, ..output }\n modport conv { ..converse(m) }\n modport sm { ..same(m) }\n modport all_in { ..input }\n}\n";
    let p = Parser::parse(src, &"i.veryl").unwrap();
    let mut v = vec![];
    for l in &p.veryl.veryl_list { veryl_sim::iface::collect(&l.description_group, &mut v); }
    let d = v[0];
    let m = |mp: &str| veryl_sim::iface::modport(d, mp).unwrap();
    let s = |v: &[(&str, bool)]| v.iter().map(|(n, o)| (n.to_string(), *o)).collect::<Vec<_>>();
    assert_eq!(m("m"), s(&[("a", true), ("b", false), ("c", true)]));
    assert_eq!(m("conv"), s(&[("a", false), ("b", true), ("c", false)]));
    assert_eq!(m("sm"), m("m"));
    assert_eq!(m("all_in"), s(&[("a", false), ("b", false), ("c", false)]));
}

/// 200-bit add and shift against the simulator's wide integers
#[test]
fn wide_200_bits() {
    use crate::value::{mask, Bits};
    synth(&["lang.veryl"], "Wide", |s| {
        let mut x = 0x9e3779b97f4a7c15u64;
        let mut rnd = move || { x ^= x << 13; x ^= x >> 7; x ^= x << 17; x };
        let m = mask(200);
        for k in 0..200 {
            let mut a = Bits([rnd(), rnd(), rnd(), rnd()]) & m;
            let b = Bits([rnd(), rnd(), rnd(), rnd()]) & m;
            if k % 3 == 0 { a = m; } // carries through every bit
            s.set_wide("i_a", a);
            s.set_wide("i_b", b);
            let sum = a.wrapping_add(b);
            assert_eq!(s.get_wide("o_s"), sum & m);
            assert_eq!(s.get("o_c"), sum.bit(200) as u128);
            assert_eq!(s.get_wide("o_x"), (a ^ (b << 150)) & m);
        }
    });
}

/// several clock domains in netsim: each `tick` clocks only its own domain
#[test]
fn clock_domains() {
    synth(&["lang.veryl"], "TwoClk", |s| {
        for r in ["i_rsta", "i_rstb", "i_rstn"] { s.set(r, 0); }
        s.tick("i_clka");
        s.tick("i_clkb");
        s.tick("i_clkn");
        for r in ["i_rsta", "i_rstb", "i_rstn"] { s.set(r, 1); }
        for _ in 0..3 { s.tick("i_clka"); }
        for _ in 0..5 { s.tick("i_clkb"); }
        for _ in 0..2 { s.tick("i_clkn"); }
        assert_eq!((s.get("o_a"), s.get("o_b"), s.get("o_n")), (3, 10, 6));
    });
}

/// the FIFO / UART / VGA examples' own testbenches on their three netlists
/// (veryl-sim gate-level simulation); VgaTiming is instantiated with smaller
/// parameters by its testbench, so that netlist is synthesized for them
#[test]
fn peripheral_testbenches() {
    for (file, top) in [("fifo.veryl", "Fifo"), ("uart.veryl", "UartLoop"), ("vga.veryl", "VgaTiming")] {
        let path = format!("{}/../examples/src/{}", env!("CARGO_MANIFEST_DIR"), file);
        let srcs = vec![(path.clone(), std::fs::read_to_string(&path).unwrap())];
        let p = Parser::parse(&srcs[0].1, &path).unwrap();
        let mut lib = Lib::new();
        lib.add(&p.veryl);
        for kind in ["opt", "ice40", "asic"] {
            let prov = crate::gatesim::Provider::new(&lib, top, kind);
            let f = |m: &str, ov: &std::collections::HashMap<String, veryl_sim::value::Val>| prov.get(m, ov);
            let r = veryl_sim::run_gates(&srcs, None, 1_000_000, false, false, Some(&f)).unwrap();
            assert!(!r.tops.is_empty() && r.tops.iter().all(|t| t.fails == 0 && t.finished), "{} {}: {}", top, kind, r.log);
            let built = prov.built.borrow();
            assert_eq!(built.len(), 1, "{} {}", top, kind);
            if top == "VgaTiming" { assert!(built[0].0.contains("H_VIS=16"), "{:?}", built[0]); }
        }
    }
}

// ---- the virtual board (src/board) ----

/// synthesize and map to iCE40 the given files (paths from the repository root)
fn ice40_of(files: &[&str], top: &str, ov: &[(&str, u128)]) -> crate::netlist::Netlist {
    let mut parsers = vec![];
    for f in files {
        let path = format!("{}/../{}", env!("CARGO_MANIFEST_DIR"), f);
        let src = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {}", path, e));
        parsers.push(Parser::parse(&src, &path).unwrap());
    }
    let mut lib = Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    let ov = ov.iter().map(|(k, v)| (k.to_string(), crate::value::Val::new(32, *v))).collect();
    let nl = crate::elab::synthesize_with(&lib, top, &ov).unwrap_or_else(|e| panic!("{}: {}", top, e)).0;
    crate::ice40::map(&nl).unwrap()
}

/// the board engine against netsim: random inputs every cycle, every output equal after every clock
#[test]
fn board_engine_matches_netsim() {
    let designs: &[(&[&str], &str)] = &[
        (&["examples/src/adder.veryl"], "Adder"), (&["examples/src/seq101.veryl"], "Seq101"), (&["examples/src/pkt_reg.veryl"], "PktReg"),
        (&["examples/src/ram.veryl"], "Ram"), (&["examples/src/sync_ram.veryl"], "SyncRam"),
        (&["examples/src/sync_ram.veryl", "veryl-eda/examples/bram_tests.veryl"], "BramMix"),
        (&["veryl-eda/examples/features.veryl"], "Top"), (&["veryl-eda/examples/pnr_tests.veryl"], "AccTest"),
        (&["veryl-eda/examples/lang.veryl"], "HsTop"), (&["examples/src/fifo.veryl"], "Fifo"), (&["examples/src/uart.veryl"], "UartLoop"),
        (&["examples/src/vga.veryl"], "VgaTiming"), (&["tutorial/src/blinky.veryl"], "Blinky"), (&["tutorial/src/knight.veryl"], "KnightRider"),
        (&["examples/src/rv32i.veryl", "veryl-eda/examples/soc.veryl"], "RiscvSoc"),
    ];
    let mut seed = 12345u64;
    let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
    for (files, top) in designs {
        let nl = ice40_of(files, top, &[]);
        let mut s = NetSim::new(&nl);
        let mut e = crate::board::Engine::new(crate::board::Design::from_netlist(&nl).unwrap()).unwrap();
        let clk = nl.ports.iter().find(|p| p.name == "i_clk").map(|p| p.name.clone());
        let ins: Vec<(String, usize)> = nl.ports.iter().filter(|p| p.dir == crate::netlist::Dir::In && Some(&p.name) != clk.as_ref()).map(|p| (p.name.clone(), p.bits.len())).collect();
        for cycle in 0..300 {
            for (name, w) in &ins {
                let v = if name == "i_rst" { (cycle >= 2 && rnd() % 50 != 0) as u128 } else { (rnd() as u128) & ((1u128 << (*w).min(64)) - 1) };
                s.poke(name, v);
                for i in 0..*w {
                    let bit = if *w > 1 { format!("{}[{}]", name, i) } else { name.clone() };
                    let n = e.input(&bit).unwrap();
                    e.set(n, (v >> i) & 1 == 1);
                }
            }
            s.settle();
            e.propagate();
            if let Some(c) = &clk {
                s.tick(c);
                let n = e.input(c).unwrap();
                e.set(n, true);
                e.propagate();
                e.set(n, false);
                e.propagate();
            }
            for p in nl.ports.iter().filter(|p| p.dir == crate::netlist::Dir::Out) {
                for (i, b) in p.bits.iter().enumerate() {
                    let bit = if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() };
                    assert_eq!(e.get(e.output(&bit).unwrap()), s.bit(*b), "{}: {} at cycle {}", top, bit, cycle);
                }
            }
        }
    }
}

/// tutorial lesson 1 on the board's pins: LEDs count, brightness = duty
#[test]
fn board_blinky_pins() {
    let nl = ice40_of(&["tutorial/src/blinky.veryl"], "Blinky", &[("WIDTH", 6)]);
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), None).unwrap();
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    let leds = [26, 27, 25, 23, 21]; // LED1..LED5 = o_led[0..4]
    // reset held: the button BTN_N (pin 10) pressed
    b.set_pin(10, false);
    b.run(3);
    b.set_pin(10, true);
    b.run(37); // cnt = 37 = 6'b100101: o_led = 5'b10010, the top bit is 1
    let led: Vec<bool> = leds.iter().map(|p| b.pin(*p).unwrap()).collect();
    assert_eq!(led, [false, true, false, false, true]);
    assert_eq!((b.pin(11), b.pin(37)), (Some(false), Some(true)), "LEDR_N lit (0), LEDG_N dark (1)");
    // over whole turns the top bit (LED5) is high half the time, LED1 (bit 1) too
    b.take_duty();
    b.run(64 * 10);
    let duty: std::collections::HashMap<u32, f64> = b.take_duty().into_iter().collect();
    assert!((duty[&21] - 0.5).abs() < 1e-9 && (duty[&26] - 0.5).abs() < 1e-9, "{:?}", duty);
}

/// tutorial lesson 2: holding BTN1 (pin 20) stops the light
#[test]
fn board_knight_button() {
    let nl = ice40_of(&["tutorial/src/knight.veryl"], "KnightRider", &[("TICK", 2), ("DIV_W", 2)]);
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), None).unwrap();
    let leds = [26, 27, 25, 23, 21];
    let pos = |b: &crate::board::Board| leds.iter().position(|p| b.pin(*p) == Some(true));
    b.set_pin(10, false);
    b.run(2);
    b.set_pin(10, true);
    assert_eq!(pos(&b), Some(0));
    b.run(9);
    assert_eq!(pos(&b), Some(4), "four steps to LED5");
    b.set_pin(20, true);
    b.run(3);
    let held = pos(&b);
    b.run(20);
    assert_eq!(pos(&b), held, "paused");
    b.set_pin(20, false);
    b.run(4);
    assert_ne!(pos(&b), held, "moves again");
}

/// speed of the board engine (printed; `cargo test --release board_speed -- --nocapture`)
#[test]
fn board_speed() {
    for (files, top) in [(&["tutorial/src/blinky.veryl"][..], "Blinky"), (&["examples/src/rv32i.veryl", "veryl-eda/examples/soc.veryl"][..], "RiscvSoc")] {
        let nl = ice40_of(files, top, &[]);
        let luts = nl.cells.iter().filter(|c| c.typ == "SB_LUT4").count();
        let pcf = std::fs::read_to_string(format!("{}/examples/icebreaker.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), if top == "Blinky" { None } else { Some(&pcf) }).unwrap();
        let t0 = std::time::Instant::now();
        let n = if top == "Blinky" { 2_000_000 } else { 200_000 };
        b.run(n);
        let s = t0.elapsed().as_secs_f64();
        println!("board speed: {} ({} LUTs): {:.2} M cycles/s = {:.1}% of 12 MHz, {:.1} evals/cycle", top, luts, n as f64 / s / 1e6, n as f64 / s / 12e6 * 100.0, b.eng.evals as f64 / n as f64);
        assert!(b.cycle == n);
    }
    // the multi-cycle SoC running a C program (a busy CPU)
    let src = std::fs::read_to_string(format!("{}/../examples/c/hello.c", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let o = crate::rv::cc::compile("hello.c", &src, &Default::default()).unwrap();
    let mut nl = ice40_of(&RVSOC, "RvBoard", &[]);
    for (m, w) in crate::bram::program_lanes(&crate::bram::mem_names(&nl), &o.program.bytes).unwrap() { crate::bram::set_mem_init(&mut nl, &m, &w); }
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvsoc.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), Some(&pcf)).unwrap();
    let t0 = std::time::Instant::now();
    let n = 200_000;
    b.run(n);
    let s = t0.elapsed().as_secs_f64();
    println!("board speed: RvBoard + hello.c: {:.2} M cycles/s = {:.1}% of 12 MHz, {:.1} evals/cycle", n as f64 / s / 1e6, n as f64 / s / 12e6 * 100.0, b.eng.evals as f64 / n as f64);
}

/// the chip database, when one is installed (the bitstream tests skip without it)
fn chip() -> Option<crate::pnr::chipdb::Chip> {
    let path = crate::pnr::chipdb::default_path()?;
    Some(crate::pnr::chipdb::Chip::load(&path, "sg48").unwrap())
}

fn pnr_of(chip: &crate::pnr::chipdb::Chip, nl: &crate::netlist::Netlist, pcf: &str) -> crate::pnr::Output {
    let o = crate::pnr::Opts { chipdb: None, package: "sg48".into(), pcf: crate::pnr::parse_pcf(pcf), seed: 1, verbose: false, timing_driven: false };
    crate::pnr::place_and_route_on(chip, nl, &o).unwrap()
}

/// .bin -> .asc -> .bin gives the same bitstream (after the comment header)
#[test]
fn bitstream_roundtrip() {
    let Some(chip) = chip() else { eprintln!("no chipdb: skipped"); return };
    for (files, top) in [(&["examples/src/sync_ram.veryl"][..], "SyncRam"), (&["examples/src/rv32i.veryl", "veryl-eda/examples/soc.veryl"][..], "RiscvSoc")] {
        let nl = ice40_of(files, top, &[]);
        let o = pnr_of(&chip, &nl, "set_io i_clk 35\n");
        let bin = crate::pnr::bitstream::asc_to_bin(&o.asc).unwrap();
        let again = crate::pnr::bitstream::asc_to_bin(&crate::pnr::bitstream::bin_to_asc(&bin).unwrap()).unwrap();
        let body = |b: &[u8]| b[b.windows(4).position(|w| w == [0x7E, 0xAA, 0x99, 0x7E]).unwrap()..].to_vec();
        assert!(body(&bin) == body(&again), "{}: bitstream changed by bin_to_asc", top);
    }
}

/// the decoded bitstream behaves like the netlist it was placed and routed from:
/// random inputs every cycle, every output equal after every clock
#[test]
fn bitstream_decode_matches_netlist() {
    let Some(chip) = chip() else { eprintln!("no chipdb: skipped"); return };
    let designs: &[(&[&str], &str, &[(&str, u128)])] = &[
        (&["examples/src/seq101.veryl"], "Seq101", &[]), (&["examples/src/pkt_reg.veryl"], "PktReg", &[]),
        (&["veryl-eda/examples/features.veryl"], "Top", &[]), (&["veryl-eda/examples/pnr_tests.veryl"], "AccTest", &[]),
        (&["examples/src/sync_ram.veryl"], "SyncRam", &[]), (&["examples/src/sync_ram.veryl", "veryl-eda/examples/bram_tests.veryl"], "BramMix", &[]),
        (&["examples/src/fifo.veryl"], "Fifo", &[]), (&["examples/src/uart.veryl"], "UartLoop", &[]),
        (&["tutorial/src/blinky.veryl"], "Blinky", &[("WIDTH", 6)]), (&["tutorial/src/knight.veryl"], "KnightRider", &[("TICK", 3), ("DIV_W", 2)]),
        (&["examples/src/rv32i.veryl", "veryl-eda/examples/soc.veryl"], "RiscvSoc", &[]),
    ];
    let mut seed = 777u64;
    let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
    for (files, top, ov) in designs {
        let nl = ice40_of(files, top, ov);
        // pins: any free ones (the place and route picks them), the clock on its global-capable pin
        let o = pnr_of(&chip, &nl, "set_io i_clk 35\n");
        let pin_of = crate::pnr::parse_pcf(&o.pcf);
        let bin = crate::pnr::bitstream::asc_to_bin(&o.asc).unwrap();
        let (dd, rep) = crate::board::bitstream::decode(&chip, &crate::board::bitstream::Config::parse_bin(&bin).unwrap()).unwrap();
        assert!(rep.warnings.is_empty(), "{}: {:?}", top, rep.warnings);
        let mut g = crate::board::Engine::new(dd).unwrap();
        let mut e = crate::board::Engine::new(crate::board::Design::from_netlist(&nl).unwrap()).unwrap();
        let bit_names = |p: &crate::netlist::Port| -> Vec<String> { (0..p.bits.len()).map(|i| if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() }).collect() };
        let ins: Vec<&crate::netlist::Port> = nl.ports.iter().filter(|p| p.dir == crate::netlist::Dir::In && p.name != "i_clk").collect();
        let outs: Vec<&crate::netlist::Port> = nl.ports.iter().filter(|p| p.dir == crate::netlist::Dir::Out).collect();
        let has_clk = nl.ports.iter().any(|p| p.name == "i_clk");
        for cycle in 0..300 {
            for p in &ins {
                for name in bit_names(p) {
                    let v = if p.name == "i_rst" { cycle >= 2 && rnd() % 50 != 0 } else { rnd() & 1 == 1 };
                    if let Some(n) = e.input(&name) { e.set(n, v); }
                    if let Some(n) = pin_of.get(&name).and_then(|pin| g.input(pin)) { g.set(n, v); }
                }
            }
            e.propagate();
            g.propagate();
            if has_clk {
                for level in [true, false] {
                    let n = e.input("i_clk").unwrap();
                    e.set(n, level);
                    e.propagate();
                    let n = g.input(&pin_of["i_clk"]).unwrap();
                    g.set(n, level);
                    g.propagate();
                }
            }
            for p in &outs {
                for name in bit_names(p) {
                    let want = e.get(e.output(&name).unwrap());
                    let pin = &pin_of[&name];
                    let got = g.get(g.output(pin).unwrap_or_else(|| panic!("{}: no output pin {} for {}", top, pin, name)));
                    assert_eq!(got, want, "{}: {} (pin {}) at cycle {}", top, name, pin, cycle);
                }
            }
        }
        println!("decoded {}: {} LCs, {} RAMs, pins in {:?}, out {:?}", top, rep.lcs, rep.rams, rep.pins_in.len(), rep.pins_out.len());
    }
}

/// tutorial lesson 1 from its bitstream, on the board's pins
#[test]
fn bitstream_blinky_on_board() {
    let Some(chip) = chip() else { eprintln!("no chipdb: skipped"); return };
    let nl = ice40_of(&["tutorial/src/blinky.veryl"], "Blinky", &[("WIDTH", 6)]);
    let o = pnr_of(&chip, &nl, crate::board::icebreaker::DEFAULT_PCF);
    let bin = crate::pnr::bitstream::asc_to_bin(&o.asc).unwrap();
    let (dd, _) = crate::board::bitstream::decode(&chip, &crate::board::bitstream::Config::parse_bin(&bin).unwrap()).unwrap();
    let mut b = crate::board::icebreaker::board_from_pins(dd).unwrap();
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    b.set_pin(10, false);
    b.run(3);
    b.set_pin(10, true);
    b.run(37);
    let led: Vec<bool> = [26, 27, 25, 23, 21].iter().map(|p| b.pin(*p).unwrap()).collect();
    assert_eq!(led, [false, true, false, false, true]);
    assert_eq!((b.pin(11), b.pin(37)), (Some(false), Some(true)));
}

/// a bitstream from nextpnr (when installed) decodes to the same behavior:
/// a check against a placer / router other than ours (globals through pads, its own packing)
#[test]
fn bitstream_decode_nextpnr() {
    let Some(chip) = chip() else { eprintln!("no chipdb: skipped"); return };
    let nextpnr = ["nextpnr-ice40", "/Users/Shared/ccc/oss-cad-suite/bin/nextpnr-ice40"].into_iter()
        .find(|p| std::process::Command::new(p).arg("--version").output().map(|o| o.status.success()).unwrap_or(false));
    let Some(nextpnr) = nextpnr else { eprintln!("no nextpnr-ice40: skipped"); return };
    let soc_pcf = format!("{}/examples/icebreaker.pcf", env!("CARGO_MANIFEST_DIR"));
    let dir = std::env::temp_dir().join(format!("veryl-eda-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let tut_pcf = dir.join("tut.pcf");
    std::fs::write(&tut_pcf, crate::board::icebreaker::DEFAULT_PCF).unwrap();
    let designs: &[(&[&str], &str, &[(&str, u128)], &std::path::Path)] = &[
        (&["tutorial/src/blinky.veryl"], "Blinky", &[("WIDTH", 6)], &tut_pcf),
        (&["tutorial/src/knight.veryl"], "KnightRider", &[("TICK", 3), ("DIV_W", 2)], &tut_pcf),
        (&["examples/src/rv32i.veryl", "veryl-eda/examples/soc.veryl"], "RiscvSoc", &[], std::path::Path::new(&soc_pcf)),
    ];
    let mut seed = 99u64;
    let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
    for (files, top, ov, pcf) in designs {
        let nl = ice40_of(files, top, ov);
        let (json, asc) = (dir.join(format!("{}.json", top)), dir.join(format!("{}.asc", top)));
        std::fs::write(&json, crate::output::to_json(&nl)).unwrap();
        let out = std::process::Command::new(nextpnr).args(["--up5k", "--package", "sg48", "--json"]).arg(&json).arg("--pcf").arg(pcf).arg("--asc").arg(&asc).output().unwrap();
        assert!(out.status.success(), "nextpnr failed on {}: {}", top, String::from_utf8_lossy(&out.stderr));
        let (dd, rep) = crate::board::bitstream::decode(&chip, &crate::board::bitstream::Config::parse_asc(&std::fs::read_to_string(&asc).unwrap()).unwrap()).unwrap();
        assert!(rep.warnings.is_empty(), "{}: {:?}", top, rep.warnings);
        let pin_of = crate::pnr::parse_pcf(&std::fs::read_to_string(pcf).unwrap());
        let mut g = crate::board::Engine::new(dd).unwrap();
        let mut e = crate::board::Engine::new(crate::board::Design::from_netlist(&nl).unwrap()).unwrap();
        for cycle in 0..300 {
            if let (Some(a), Some(b)) = (e.input("i_rst"), pin_of.get("i_rst").and_then(|p| g.input(p))) {
                let v = cycle >= 2 && rnd() % 50 != 0;
                e.set(a, v);
                g.set(b, v);
            }
            if let (Some(a), Some(b)) = (e.input("i_btn"), pin_of.get("i_btn").and_then(|p| g.input(p))) {
                let v = rnd() % 4 == 0;
                e.set(a, v);
                g.set(b, v);
            }
            e.propagate();
            g.propagate();
            for level in [true, false] {
                let n = e.input("i_clk").unwrap();
                e.set(n, level);
                e.propagate();
                let n = g.input(&pin_of["i_clk"]).unwrap();
                g.set(n, level);
                g.propagate();
            }
            for (name, n) in &e.d.outputs {
                let Some(pin) = pin_of.get(name) else { continue };
                assert_eq!(g.get(g.output(pin).unwrap()), e.get(*n), "nextpnr {}: {} (pin {}) at cycle {}", top, name, pin, cycle);
            }
        }
        println!("nextpnr {}: {} LCs, pins in {:?}", top, rep.lcs, rep.pins_in);
    }
}

// ---- the virtual board's peripherals (src/board/periph.rs) ----

fn board_of(files: &[&str], top: &str, ov: &[(&str, u128)], pcf: Option<&str>) -> crate::board::Board {
    let nl = ice40_of(files, top, ov);
    let pcf = pcf.map(|p| std::fs::read_to_string(format!("{}/../{}", env!("CARGO_MANIFEST_DIR"), p)).unwrap());
    crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), pcf.as_deref()).unwrap()
}

/// tutorial lesson 3 on the USB serial port: greeting, then the echo with the case swapped
#[test]
fn board_uart_echo() {
    for (ov, cpb) in [(&[("CLKS_PER_BIT", 8u128), ("CNT_W", 4)][..], 8.0), (&[][..], 12e6 / 115200.0)] {
        let mut b = board_of(&["tutorial/src/uart.veryl"], "UartEcho", ov, None);
        assert!(b.warnings.is_empty(), "{:?}", b.warnings);
        b.attach_uart(9, 6, cpb);
        b.set_pin(10, false);
        b.run(3);
        b.set_pin(10, true);
        b.run((cpb * 10.0 * 6.0) as u64);
        let u = b.uart.as_mut().unwrap();
        assert_eq!(String::from_utf8_lossy(&std::mem::take(&mut u.received)), "Hi!\r\n");
        u.queue.extend(b"aB?".iter().copied());
        b.run((cpb * 10.0 * 8.0) as u64);
        let u = b.uart.as_mut().unwrap();
        assert_eq!(String::from_utf8_lossy(&u.received), "Ab?", "cpb {}", cpb);
        assert_eq!(u.framing_errors, 0);
    }
}

/// the multiplexed seven-segment display: each digit shows its own pattern, lit half the time
#[test]
fn board_sevenseg() {
    let mut b = board_of(&["examples/src/sevenseg.veryl"], "SevenSeg", &[("TICK", 4), ("TICK_W", 3), ("MUX_W", 2)], Some("examples/sevenseg.pcf"));
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    let segs = [Some(4), Some(2), Some(47), Some(45), Some(3), Some(48), Some(46), None];
    b.attach_seg(segs, &[(44, false), (44, true)], true);
    b.set_pin(10, false);
    b.run(2);
    b.set_pin(10, true);
    b.run(4 * 12 - 2); // the count reaches 12
    let w = b.window;
    b.take_segs(w);
    b.take_duty();
    b.run(3); // less than one tick: still 12
    let w = b.window;
    let d = b.take_segs(w);
    let lit = |digit: usize| -> Vec<usize> { (0..7).filter(|k| d[0][digit][*k] > 0.0).collect() };
    assert_eq!(lit(0), vec![0, 1, 3, 4, 6], "ones digit 2 (a b d e g): {:?}", d[0]);
    assert_eq!(lit(1), vec![1, 2], "tens digit 1 (b c): {:?}", d[0]);
}

/// the VGA monitor: a 640×480 frame of the color bars, scanned at one pixel per clock
#[test]
fn board_vga() {
    let mut b = board_of(&["examples/src/vga.veryl"], "VgaTiming", &[], Some("examples/vga.pcf"));
    b.attach_vga(42, 36, &[45], &[31], &[44]);
    b.set_pin(10, false);
    b.run(2);
    b.set_pin(10, true);
    b.run(800 * 525 * 2 + 1000);
    let g = b.vga.as_ref().unwrap();
    let (w, h, px) = g.frame.as_ref().expect("a complete frame");
    assert_eq!((*w, *h), (800, 525));
    // line = from HSYNC (x = 656), frame = from VSYNC (y = 490)
    for (x, y) in [(5u32, 3u32), (100, 10), (200, 100), (330, 470), (639, 479), (650, 200), (100, 485)] {
        let (col, row) = (((x + 800 - 656) % 800) as usize, ((y + 525 - 490) % 525) as usize);
        let video = x < 640 && y < 480;
        let rgb = if video { (x >> 7) ^ ((x >> 6) & 1) } else { 0 } & 7;
        let want = (if rgb & 4 != 0 { 0xf00 } else { 0 }) | (if rgb & 2 != 0 { 0x0f0 } else { 0 }) | (if rgb & 1 != 0 { 0x00f } else { 0 });
        assert_eq!(px[row * w + col], want, "pixel x {} y {}", x, y);
    }
    let rle = crate::board::periph::rle(px);
    assert!(rle.len() < px.len() / 10, "color bars compress: {} bytes", rle.len());
}

// ---- the multi-cycle RISC-V SoC with its program in block RAM (examples/src/rvsoc.veryl) ----

const RVSOC: [&str; 4] = ["examples/src/rv32i.veryl", "examples/src/sync_ram.veryl", "examples/src/uart.veryl", "examples/src/rvsoc.veryl"];

/// rv32i_test.S as built for TestRvSoc (data at 0x300): the program bytes and the expected (word, value) results
fn rvsoc_test_program() -> (Vec<u8>, Vec<(usize, u64)>) {
    let root = format!("{}/..", env!("CARGO_MANIFEST_DIR"));
    let rom = std::fs::read_to_string(format!("{}/examples/src/rvsoc_rom.veryl", root)).unwrap();
    let mut bytes = vec![];
    for l in rom.lines() {
        let Some((a, rest)) = l.trim().strip_prefix("10'h").and_then(|r| r.split_once(" : o_inst = 32'h")) else { continue };
        let a = usize::from_str_radix(a, 16).unwrap();
        let w = u32::from_str_radix(&rest[..8], 16).unwrap();
        if bytes.len() < a + 4 { bytes.resize(a + 4, 0); }
        bytes[a..a + 4].copy_from_slice(&w.to_le_bytes());
    }
    let tb = std::fs::read_to_string(format!("{}/examples/src/rvsoc.veryl", root)).unwrap();
    let exp = tb.lines().filter_map(|l| {
        let (_, r) = l.split_once("ld_addr = 8'd")?;
        let (i, r) = r.split_once(';')?;
        let (_, v) = r.split_once("ld_rdata == 32'h")?;
        Some((i.parse().ok()?, u64::from_str_radix(&v[..8], 16).ok()?))
    }).collect::<Vec<_>>();
    assert_eq!(exp.len(), 41);
    (bytes, exp)
}

/// the SoC's 32-bit words from its four byte lanes on a board
fn rvsoc_words(b: &crate::board::Board, lanes: &[(String, Vec<u64>)], map: &[crate::pnr::RamPos]) -> Vec<u64> {
    let l: Vec<Vec<u64>> = lanes.iter().map(|(m, _)| b.mem_words(m, map)).collect();
    (0..l[0].len()).map(|i| (0..4).fold(0, |a, k| a | (l[k][i] & 0xff) << (8 * k))).collect()
}

/// RvBoard with rv32i_test.S in its block RAMs runs it on the virtual board: from the
/// netlist, and from a bitstream placed and routed without the program and patched afterwards
/// (the same bitstream as placing and routing the netlist with the program)
#[test]
fn rvsoc_program_on_board() {
    let (bytes, exp) = rvsoc_test_program();
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvsoc.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let empty = ice40_of(&RVSOC, "RvBoard", &[]);
    let lanes = crate::bram::program_lanes(&crate::bram::mem_names(&empty), &bytes).unwrap();
    assert_eq!(lanes.len(), 4);
    let mut nl = ice40_of(&RVSOC, "RvBoard", &[]);
    for (m, w) in &lanes { assert_eq!(crate::bram::set_mem_init(&mut nl, m, w), 4, "{}: 2048×8 = four 512×8 blocks", m); }
    let check = |b: &mut crate::board::Board, map: &[crate::pnr::RamPos], what: &str| {
        b.set_pin(10, false);
        b.run(3);
        b.set_pin(10, true);
        b.run(2000);
        let w = rvsoc_words(b, &lanes, map);
        for (i, v) in &exp { assert_eq!(w[*i], *v, "{}: word {} (0x{:x})", what, i, i * 4); }
    };
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), Some(&pcf)).unwrap();
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    check(&mut b, &[], "netlist");
    let Some(chip) = chip() else { eprintln!("no chipdb: bitstream part skipped"); return };
    let o = pnr_of(&chip, &empty, &pcf);
    let map = o.ram_map();
    assert_eq!(map.len(), 20);
    let mut asc = o.asc.clone();
    for (m, w) in &lanes { let (a, n) = crate::pnr::patch_ram(&asc, &map, m, w).unwrap(); assert_eq!(n, 4); asc = a; }
    assert!(asc == pnr_of(&chip, &nl, &pcf).asc, "patching the program equals placing and routing it");
    let bin = crate::pnr::bitstream::asc_to_bin(&asc).unwrap();
    let (dd, rep) = crate::board::bitstream::decode(&chip, &crate::board::bitstream::Config::parse_bin(&bin).unwrap()).unwrap();
    assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    let mut b = crate::board::icebreaker::board_from_pins(dd).unwrap();
    check(&mut b, &map, "bitstream");
}

// ---- the C compiler (src/rv): programs on the instruction-set simulator and on RvSoc ----

/// a C test program (src/rv/tests) compiled and run on the ISS: its serial output
fn cc_run(name: &str) -> (Vec<u8>, String, u64) {
    let dir = format!("{}/src/rv/tests", env!("CARGO_MANIFEST_DIR"));
    let src = std::fs::read_to_string(format!("{}/{}.c", dir, name)).unwrap();
    let o = crate::rv::cc::compile(&format!("{}.c", name), &src, &Default::default()).unwrap_or_else(|e| panic!("{:?}", e));
    let mut s = crate::rv::iss::Iss::new(&o.program.bytes, 8192);
    assert!(s.run(20_000_000).unwrap(), "{} did not halt", name);
    (o.program.bytes, String::from_utf8_lossy(&s.tx).to_string(), s.cycles)
}

/// each program prints what the host C compiler's build of it prints (the .out files,
/// from `cc -funsigned-char -fwrapv`; RISC-V's char is unsigned)
#[test]
fn cc_programs() {
    let dir = format!("{}/src/rv/tests", env!("CARGO_MANIFEST_DIR"));
    let mut n = 0;
    for f in std::fs::read_dir(&dir).unwrap() {
        let p = f.unwrap().path();
        if p.extension().map(|e| e == "c") != Some(true) { continue; }
        let name = p.file_stem().unwrap().to_string_lossy().to_string();
        let want = std::fs::read_to_string(p.with_extension("out")).unwrap();
        let (_, got, _) = cc_run(&name);
        assert_eq!(got.replace("\r\n", "\n"), want, "{}", name);
        n += 1;
    }
    assert!(n >= 3);
}

/// the same programs, and those in tests/linux (system calls: files, the heap), compiled
/// for Linux on RV64 (`Options::linux`) and run with spike's proxy kernel (pk: the same
/// system call numbers as Linux): the same output. Without spike / pk (SPIKE, PK) only
/// the executables are checked.
#[test]
fn cc_linux_programs() {
    let dir = format!("{}/src/rv/tests", env!("CARGO_MANIFEST_DIR"));
    let spike = std::env::var("SPIKE").unwrap_or("spike".into());
    let pk = std::env::var("PK").unwrap_or("/opt/homebrew/opt/riscv-pk/riscv64-unknown-elf/bin/pk".into());
    let have = std::path::Path::new(&pk).exists() && std::process::Command::new(&spike).arg("--help").output().is_ok();
    let tmp = std::env::temp_dir().join(format!("veryl_cc_linux_{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let mut n = 0;
    let files: Vec<std::path::PathBuf> = [dir.clone(), format!("{}/linux", dir)].iter().flat_map(|d| std::fs::read_dir(d).unwrap().map(|f| f.unwrap().path())).collect();
    for p in files {
        if p.extension().map(|e| e == "c") != Some(true) { continue; }
        let name = p.file_stem().unwrap().to_string_lossy().to_string();
        let src = std::fs::read_to_string(&p).unwrap();
        let o = crate::rv::cc::compile(&format!("{}.c", name), &src, &crate::rv::cc::Options { linux: true, ..Default::default() }).unwrap_or_else(|e| panic!("{}: {:?}", name, e));
        let elf = o.elf.unwrap();
        assert_eq!(&elf[..4], b"\x7fELF");
        assert_eq!(u16::from_le_bytes([elf[18], elf[19]]), 243, "EM_RISCV");
        n += 1;
        if !have { continue; }
        let exe = tmp.join(&name);
        std::fs::write(&exe, &elf).unwrap();
        let r = std::process::Command::new(&spike).args(["--isa=rv64imac", &pk, exe.to_str().unwrap()]).current_dir(&tmp).output().unwrap();
        let got = String::from_utf8_lossy(&r.stdout).replace("bbl loader\r\n", "").replace("bbl loader\n", "");
        let want = std::fs::read_to_string(p.with_extension("out")).unwrap();
        assert_eq!(got, want, "{} (spike pk)", name);
    }
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(n >= 4);
    eprintln!("cc_linux_programs: {} programs{}", n, if have { " match on spike + pk" } else { " compiled (no spike / pk)" });
}

/// compile errors point at the line
#[test]
fn cc_errors() {
    let e = |src: &str| crate::rv::cc::compile("t.c", src, &Default::default()).err().unwrap_or_default();
    let x = e("int main(void) {\n  int a;\n  b = 1;\n  return 0;\n}\n");
    assert!(x.iter().any(|d| d.line == 3 && d.msg.contains("'b' is not declared")), "{:?}", x);
    let x = e("int main(void) {\n  int *p;\n  p = 5;\n  foo(1);\n}\n");
    assert!(x.iter().any(|d| d.line == 3 && d.msg.contains("cast")), "{:?}", x);
    assert!(x.iter().any(|d| d.line == 4 && d.msg.contains("foo is not declared")), "{:?}", x);
    let x = e("int f(int a) { return a; }\nint main(void) { return f(1, 2) }\n");
    assert!(x.iter().any(|d| d.line == 2), "{:?}", x);
    let x = e("int main(void) { struct s x; }\n");
    assert!(!x.is_empty());
}

/// the assembler round trip: every RV32I instruction the compiler can emit, assembled and executed
#[test]
fn asm_and_iss() {
    let p = crate::rv::asm::assemble(".text\n_start:\n li sp, 0x1000\n li a0, 0x12345678\n li a1, -5\n add a2, a0, a1\n la t0, val\n lw t1, 0(t0)\n sw a2, 4(t0)\n lbu t2, 3(t0)\n lb t3, 2(t0)\n call f\n j .\nf:\n addi a0, a0, 1\n ret\n .data\nval: .word 0x80ff0102, 0\n").unwrap();
    let mut s = crate::rv::iss::Iss::new(&p.bytes, 8192);
    assert!(s.run(100).unwrap());
    let r = |n: &str| s.x[crate::rv::asm::reg(n).unwrap() as usize];
    assert_eq!((r("a0"), r("a2"), r("t1"), r("t2"), r("t3")), (0x12345679, 0x12345673, 0x80ff0102, 0x80, 0xffffffff));
    assert!(crate::rv::asm::assemble("addi a0, a0, 5000").is_err());
}

/// a compiled C program on the gate-level RvBoard (program in its block RAMs) on the virtual
/// board prints over the USB serial port exactly what it prints on the ISS
#[test]
fn cc_on_rvsoc() {
    let (bytes, want, cycles) = cc_run("pointers");
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvsoc.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut nl = ice40_of(&RVSOC, "RvBoard", &[]);
    for (m, w) in crate::bram::program_lanes(&crate::bram::mem_names(&nl), &bytes).unwrap() { crate::bram::set_mem_init(&mut nl, &m, &w); }
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), Some(&pcf)).unwrap();
    b.attach_uart(9, 6, 104.0);
    b.set_pin(10, false);
    b.run(3);
    b.set_pin(10, true);
    // the serial port is slower than the ISS assumes: 10 bits × 104 cycles per character
    b.run(cycles + want.len() as u64 * 1100 + 10_000);
    let u = b.uart.as_ref().unwrap();
    assert_eq!(String::from_utf8_lossy(&u.received), want);
    assert_eq!(u.framing_errors, 0);
}

/// the threads example (timer interrupts, ecall, amoswap, mul / rem) with a short time slice and
/// sleeps: the gate-level RvBoard and the ISS agree cycle by cycle (same output, same LEDs)
#[test]
fn threads_on_rvsoc() {
    let src = std::fs::read_to_string(format!("{}/../examples/c/threads.c", env!("CARGO_MANIFEST_DIR"))).unwrap()
        .replace("#define SLICE    120000", "#define SLICE    3000").replace("frame[10] * 12000", "frame[10] * 150").replace("count % 200 == 0", "count % 20 == 0");
    let bytes = crate::rv::cc::compile("threads.c", &src, &Default::default()).unwrap_or_else(|e| panic!("{:?}", e)).program.bytes;
    const CYCLES: u64 = 600_000;
    let mut s = crate::rv::iss::Iss::new(&bytes, 8192);
    s.tx_cycles = 1040;
    while s.cycles < CYCLES { s.step_until(CYCLES).unwrap(); }
    let want = String::from_utf8_lossy(&s.tx).to_string();
    assert!(want.contains("A: 16") && want.contains("B: 8") && want.contains("primes: #40 "), "{}", want);
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvsoc.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut nl = ice40_of(&RVSOC, "RvBoard", &[]);
    for (m, w) in crate::bram::program_lanes(&crate::bram::mem_names(&nl), &bytes).unwrap() { crate::bram::set_mem_init(&mut nl, &m, &w); }
    let mut b = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), Some(&pcf)).unwrap();
    b.attach_uart(9, 6, 104.0);
    b.set_pin(10, false);
    b.run(3);
    b.set_pin(10, true);
    b.run(CYCLES);
    let u = b.uart.as_ref().unwrap();
    let got = String::from_utf8_lossy(&u.received).to_string();
    // the last bytes are still on the wire
    assert!(want.starts_with(&got) && want.len() - got.len() <= 2, "gates:\n{}\niss:\n{}", got, want);
    assert_eq!(u.framing_errors, 0);
    let led = [4, 2, 47, 45, 3, 48, 46, 44].iter().enumerate().fold(0, |a, (i, p)| a | (b.pin(*p).unwrap() as u32) << i);
    assert_eq!(led, s.led & 255);
}

/// a C example (examples/c) compiled
fn c_example(name: &str) -> Vec<u8> {
    let src = std::fs::read_to_string(format!("{}/../examples/c/{}.c", env!("CARGO_MANIFEST_DIR"), name)).unwrap();
    crate::rv::cc::compile(&format!("{}.c", name), &src, &Default::default()).unwrap().program.bytes
}

/// the CPU board (RvSoc's pins, the CPU as an instruction-set simulator): the serial port at
/// its real speed, switches to LEDs, the reset button, the seven-segment display; and its speed
#[test]
fn cpu_board() {
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvsoc.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut b = crate::board::Board::cpu(&c_example("hello"), 8192, &pcf, 35).unwrap();
    assert!(b.warnings.is_empty(), "{:?}", b.warnings);
    b.attach_uart(9, 6, 104.0);
    b.run(60_000);
    let got = String::from_utf8_lossy(&b.uart.as_ref().unwrap().received).to_string();
    // 1040 cycles per byte: about 57 bytes in 60000 cycles
    assert!(got.starts_with("Hello from C") && got.len() > 40 && got.len() < 70, "{:?} ({} bytes)", got, got.len());
    b.uart.as_mut().unwrap().queue.extend(b"ok!");
    b.run(100_000);
    assert!(String::from_utf8_lossy(&b.uart.as_ref().unwrap().received).ends_with("OK!"));
    // the LEDs count every 200 ms
    b.run(2_400_000 * 2);
    let led = |b: &crate::board::Board| [4, 2, 47, 45, 3, 48, 46, 44].iter().enumerate().fold(0, |a, (i, p)| a | (b.pin(*p).unwrap() as u32) << i);
    assert_eq!(led(&b), 2);
    // switches -> LEDs; the reset button restarts the program
    b.load_program(&c_example("switches")).unwrap();
    for (i, p) in [43, 38, 34, 31, 42, 36, 32, 28].iter().enumerate() { b.set_pin(*p, i % 3 == 0); }
    b.run(100_000);
    assert_eq!(led(&b), 0b0100_1001);
    b.set_pin(10, false);
    b.run(1000);
    assert_eq!(led(&b), 0);
    b.set_pin(10, true);
    b.run(100_000);
    assert_eq!(led(&b), 0b0100_1001);
    // seven-segment: 00 then counting; both digits lit about half the time
    let mut b = crate::board::Board::cpu(&c_example("sevenseg"), 8192, &pcf, 35).unwrap();
    b.attach_seg([Some(4), Some(2), Some(47), Some(45), Some(3), Some(48), Some(46), None], &[(44, false), (44, true)], true);
    b.run(12_000_000 / 4 * 3 + 50_000);
    b.take_segs(1);
    b.take_duty();
    b.run(100_000);
    let w = b.window;
    let s = b.take_segs(w);
    let pattern = |d: &[f64; 8]| d[..7].iter().enumerate().fold(0u8, |a, (k, x)| a | ((*x > 0.2) as u8) << k);
    assert_eq!((pattern(&s[0][0]), pattern(&s[0][1])), (0x4f, 0x3f), "3 and 0 after 0.75 s: {:?}", s);
    // speed
    let mut b = crate::board::Board::cpu(&c_example("knight"), 8192, &pcf, 35).unwrap();
    let t0 = std::time::Instant::now();
    b.run(12_000_000);
    println!("CPU board: {:.1} x real time", 1.0 / t0.elapsed().as_secs_f64());
}

/// VGA text mode: the C example on the gate-level RvVgaBoard (the monitor sampling its pins)
/// shows the same 640 × 480 picture as the CPU board renders from the ISS's screen memory
#[test]
fn vga_text_on_board() {
    let prog = c_example("vga");
    let pcf = std::fs::read_to_string(format!("{}/../examples/rvvga.pcf", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let files = ["examples/src/rv32i.veryl", "examples/src/sync_ram.veryl", "examples/src/uart.veryl", "examples/src/rvsoc.veryl", "examples/src/vga.veryl", "examples/src/rvvga.veryl"];
    let mut nl = ice40_of(&files, "RvVgaBoard", &[]);
    assert_eq!(nl.cells.iter().filter(|c| c.typ == "SB_RAM40_4K").count(), 26);
    for (m, w) in crate::bram::program_lanes(&crate::bram::mem_names(&nl), &prog).unwrap() { crate::bram::set_mem_init(&mut nl, &m, &w); }
    let frame = |b: &mut crate::board::Board| {
        b.attach_vga(42, 36, &[45, 47, 2, 4], &[31, 34, 38, 43], &[44, 46, 48, 3]);
        b.run(1_400_000);
        let (w, h, px) = b.vga.as_ref().unwrap().frame.clone().expect("a frame");
        assert_eq!((w, h), (800, 525));
        (0..480).flat_map(|y| (0..640).map(move |x| (x, y))).map(|(x, y)| px[(y + 35) * w + x + 144]).collect::<Vec<u16>>()
    };
    let mut g = crate::board::icebreaker::board(crate::board::Design::from_netlist(&nl).unwrap(), Some(&pcf)).unwrap();
    assert!(g.warnings.is_empty(), "{:?}", g.warnings);
    let hw = frame(&mut g);
    let mut c = crate::board::Board::cpu(&prog, 8192, &pcf, 35).unwrap();
    let sw = frame(&mut c);
    // yellow on dark blue, the title in the box
    assert!(hw.iter().filter(|p| **p == 0xff0).count() > 2000 && hw.iter().filter(|p| **p == 0x00a).count() > 200_000);
    let diff = hw.iter().zip(&sw).filter(|(a, b)| a != b).count();
    assert_eq!(diff, 0, "{} pixels differ", diff);
}

/// the instruction-set simulator runs rv32ima_test.S (M, A, Zicsr, traps) with spike's results
#[test]
fn iss_rv32ima_matches_spike() {
    let src = std::fs::read_to_string(format!("{}/../examples/src/rvsoc_ima_test.veryl", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut bytes = vec![0u8; 1024];
    let mut exp = vec![];
    for l in src.lines() {
        let l = l.trim();
        if let Some((a, rest)) = l.strip_prefix("10'h").and_then(|r| r.split_once(" : o_inst = 32'h")) {
            let a = usize::from_str_radix(a, 16).unwrap();
            bytes[a..a + 4].copy_from_slice(&u32::from_str_radix(&rest[..8], 16).unwrap().to_le_bytes());
        } else if let Some((_, r)) = l.split_once("ld_rdata == 32'h") {
            exp.push(u32::from_str_radix(&r[..8], 16).unwrap());
        }
    }
    assert_eq!(exp.len(), 59);
    let mut s = crate::rv::iss::Iss::new(&bytes, 2048);
    assert!(s.run(10_000).unwrap(), "halts");
    for (i, v) in exp.iter().enumerate() {
        let a = 0x400 + 4 * i;
        assert_eq!(u32::from_le_bytes(s.mem[a..a + 4].try_into().unwrap()), *v, "word {}", i);
    }
}
