//! Technology mapping for Lattice ECP5, the cells nextpnr-ecp5 reads (yosys'
//! `techlibs/ecp5/cells_sim.v` are the models): `LUT4` (the same cut-based
//! covering as iCE40), `CCU2C` for full-adder carry chains (two bits per cell
//! when the carry between them goes nowhere else; otherwise the second half only
//! passes the carry on, so the carry can leave the chain) and `TRELLIS_FF`.
//! Memories stay flip-flops for now.

use crate::ice40::{find_carries, lut_cover, truth, PAT};
use crate::netlist::*;
use std::collections::HashMap;

type R<T> = Result<T, String>;

/// CCU2C half that adds A + B + CIN (C = 0, D = 1: LUT4 = A ^ B, LUT2 = A), as yosys does
pub const ADD_INIT: u16 = 0x96AA;
/// CCU2C half that only passes the carry on (LUT4 = 1: COUT = CIN)
pub const PASS_INIT: u16 = 0xFFFF;

pub fn map(nl: &Netlist) -> R<Netlist> {
    let gates: Vec<&Cell> = nl.cells.iter().filter(|c| !c.is_ff()).collect();
    let mut node: HashMap<u32, usize> = HashMap::new();
    for (i, c) in gates.iter().enumerate() {
        if let Bit::W(w) = c.out() { node.insert(w, i); }
    }
    let pos = node.clone();

    // carry chain bits: carry-out n = maj(x, y, ci) and, if the design has it, the sum x ^ y ^ ci
    let carry = find_carries(&gates, &node);
    let mut xor_of: HashMap<(Bit, Bit), u32> = HashMap::new();
    for c in gates.iter().filter(|c| c.typ == "$_XOR_") {
        let (a, b) = (c.port("A").unwrap(), c.port("B").unwrap());
        if let Bit::W(y) = c.out() { xor_of.insert((a, b), y); xor_of.insert((b, a), y); }
    }
    struct Chain { x: Bit, y: Bit, ci: Bit, sum: Option<u32> }
    let mut bits: HashMap<u32, Chain> = HashMap::new();
    let mut owner: HashMap<u32, u32> = HashMap::new();
    for (n, (x, y, ci, p)) in &carry {
        let sum = xor_of.get(&(Bit::W(*p), *ci)).copied();
        owner.insert(*n, *n);
        if let Some(s) = sum {
            // two carries with the same inputs share one sum: only the first one makes it
            if !owner.contains_key(&s) { owner.insert(s, *n); }
        }
        bits.insert(*n, Chain { x: *x, y: *y, ci: *ci, sum: sum.filter(|s| owner.get(s) == Some(n)) });
    }
    let mut fixed: HashMap<u32, Vec<Bit>> = HashMap::new();
    for (w, n) in &owner {
        node.remove(w);
        let b = &bits[n];
        fixed.insert(*w, vec![b.x, b.y, b.ci]);
    }

    // roots: everything sequential logic and output ports look at
    let mut roots: Vec<Bit> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.clone()).collect();
    for c in nl.cells.iter().filter(|c| c.is_ff()) {
        for (p, b) in &c.conns { if !is_out(p) { roots.push(*b); } }
    }
    let (best, used, used_fixed) = lut_cover(&gates, &node, &fixed, &roots)?;

    let mut cells: Vec<Cell> = vec![];
    // in gate order (deterministic output)
    let mut lut_order: Vec<u32> = used.iter().copied().collect();
    lut_order.sort_by_key(|n| pos[n]);
    for n in lut_order {
        let leaves = &best[&n].leaves;
        let mut memo: HashMap<u32, u16> = HashMap::new();
        for (i, l) in leaves.iter().enumerate() { memo.insert(*l, PAT[i]); }
        let tt = truth(n, &gates, &pos, &mut memo);
        let mut conns: Vec<(&'static str, Bit)> = vec![];
        for (i, p) in ["A", "B", "C", "D"].iter().enumerate() {
            conns.push((p, leaves.get(i).map(|w| Bit::W(*w)).unwrap_or(Bit::C0)));
        }
        conns.push(("Z", Bit::W(n)));
        cells.push(Cell { typ: "LUT4".into(), conns, params: vec![("INIT", format!("{:016b}", tt))] });
    }
    // the chain bits that are needed (for their carry, their sum or both), in gate order
    let mut need: Vec<u32> = used_fixed.iter().map(|w| owner[w]).collect();
    need.sort_by_key(|n| (pos[n], *n));
    need.dedup();
    // uses of every wire by the other cells: a carry used only as the next bit's carry-in can
    // stay inside one CCU2C (bit i in the first half, bit i + 1 in the second)
    let mut uses: HashMap<Bit, usize> = HashMap::new();
    for n in &used { for l in &best[n].leaves { *uses.entry(Bit::W(*l)).or_default() += 1; } }
    for b in &roots { *uses.entry(*b).or_default() += 1; }
    for n in &need { let b = &bits[n]; for x in [b.x, b.y, b.ci] { *uses.entry(x).or_default() += 1; } }
    let mut next_of: HashMap<Bit, u32> = HashMap::new();
    for n in &need { next_of.insert(bits[n].ci, *n); }
    let mut done: std::collections::HashSet<u32> = Default::default();
    for &i in &need {
        if done.contains(&i) { continue; }
        done.insert(i);
        let j = next_of.get(&Bit::W(i)).copied().filter(|j| !done.contains(j) && uses.get(&Bit::W(i)) == Some(&1));
        let b0 = &bits[&i];
        let mut conns: Vec<(&'static str, Bit)> = vec![("A0", b0.x), ("B0", b0.y), ("C0", Bit::C0), ("D0", Bit::C1), ("CIN", b0.ci)];
        if let Some(s) = b0.sum { conns.push(("S0", Bit::W(s))); }
        let init1 = if let Some(j) = j {
            done.insert(j);
            let b1 = &bits[&j];
            conns.extend([("A1", b1.x), ("B1", b1.y), ("C1", Bit::C0), ("D1", Bit::C1), ("COUT", Bit::W(j))]);
            if let Some(s) = b1.sum { conns.push(("S1", Bit::W(s))); }
            ADD_INIT
        } else {
            conns.extend([("A1", Bit::C0), ("B1", Bit::C0), ("C1", Bit::C0), ("D1", Bit::C0), ("COUT", Bit::W(i))]);
            PASS_INIT
        };
        cells.push(Cell { typ: "CCU2C".into(), conns, params: vec![
            ("INIT0", format!("{:016b}", ADD_INIT)), ("INIT1", format!("{:016b}", init1)),
            ("INJECT1_0", "NO".into()), ("INJECT1_1", "NO".into())] });
    }
    // a carry chain does not branch: a COUT feeds at most one CIN directly, any other
    // carry-in gets it through the fabric (a buffer LUT; nextpnr adds the feed-out / feed-in)
    let mut next_wire = nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()))
        .chain(cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)))
        .filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1;
    let couts: std::collections::HashSet<Bit> = cells.iter().filter(|c| c.typ == "CCU2C").filter_map(|c| c.port("COUT")).collect();
    let mut seen: std::collections::HashSet<Bit> = Default::default();
    let mut bufs = vec![];
    for c in cells.iter_mut().filter(|c| c.typ == "CCU2C") {
        let Some(k) = c.conns.iter().position(|x| x.0 == "CIN") else { continue };
        let ci = c.conns[k].1;
        if !couts.contains(&ci) || seen.insert(ci) { continue; }
        let y = Bit::W(next_wire);
        next_wire += 1;
        bufs.push(Cell { typ: "LUT4".into(), conns: vec![("A", ci), ("B", Bit::C0), ("C", Bit::C0), ("D", Bit::C0), ("Z", y)], params: vec![("INIT", format!("{:016b}", PAT[0]))] });
        c.conns[k].1 = y;
    }
    cells.extend(bufs);
    let mut cells = topo(cells);

    // flip-flops: $_DFF_P_ / $_DFF_PN0_ / $_SDFF_NP1_ ... (clock and reset polarity are muxes in the slice)
    for c in nl.cells.iter().filter(|c| c.is_ff()) {
        let t = c.typ.as_str();
        let f: Vec<char> = t.trim_start_matches("$_").trim_start_matches('S').trim_start_matches("DFF_").chars().collect();
        let (q, d, ck) = (c.port("Q").unwrap(), c.port("D").unwrap(), c.port("C").unwrap());
        let mut conns = vec![("CLK", ck), ("DI", d), ("Q", q)];
        let mut params = vec![("GSR", "DISABLED".to_string()), ("CEMUX", "1".into()), ("CLKMUX", if f[0] == 'N' { "INV" } else { "CLK" }.into())];
        if let Some(r) = c.port("R") {
            conns.push(("LSR", r));
            params.push(("LSRMUX", if f[1] == 'N' { "INV" } else { "LSR" }.into()));
            params.push(("REGSET", if f[2] == '1' { "SET" } else { "RESET" }.into()));
            params.push(("SRMODE", if t.starts_with("$_SDFF") { "LSR_OVER_CE" } else { "ASYNC" }.into()));
        } else {
            params.push(("REGSET", "RESET".into()));
        }
        cells.push(Cell { typ: "TRELLIS_FF".into(), conns, params });
    }

    // keep only net names whose bits still exist
    let mut live: std::collections::HashSet<Bit> = cells.iter().flat_map(|c| c.conns.iter().filter(|(p, _)| is_out(p)).map(|x| x.1)).collect();
    for p in &nl.ports { live.extend(p.bits.iter().copied()); }
    let nets = nl.nets.iter().filter(|(_, b)| b.iter().all(|x| x.is_const() || live.contains(x))).cloned().collect();
    let ports = nl.ports.iter().map(|p| Port { name: p.name.clone(), dir: p.dir, bits: p.bits.clone() }).collect();
    Ok(Netlist { name: nl.name.clone(), ports, nets, cells })
}

/// parameters that are strings, not bit vectors (yosys JSON marks a string of 0 / 1 with a trailing space)
pub fn is_string_param(cell: &str, k: &str) -> bool {
    matches!(cell, "TRELLIS_FF" | "CCU2C") && !matches!(k, "INIT0" | "INIT1")
}

/// CCU2C outputs (S0, S1, COUT) from its inputs, as yosys' model computes them
pub fn ccu2c(c: &Cell, get: impl Fn(&str) -> bool) -> (bool, bool, bool) {
    let p = |k: &str| c.params.iter().find(|x| x.0 == k).map(|x| x.1.trim().to_string()).unwrap_or_default();
    let init = |k: &str| u16::from_str_radix(&p(k), 2).unwrap_or(0);
    let lut = |init: u16, a: bool, b: bool, cc: bool, d: bool| (init >> (a as u16 | (b as u16) << 1 | (cc as u16) << 2 | (d as u16) << 3)) & 1 == 1;
    let half = |init: u16, inject: bool, ins: [bool; 4], cin: bool| {
        let l4 = lut(init, ins[0], ins[1], ins[2], ins[3]);
        let l2 = (init >> (ins[0] as u16 | (ins[1] as u16) << 1)) & 1 == 1;
        let s = l4 ^ (!inject && cin);
        let co = (!l4 && !inject && l2) || (l4 && cin);
        (s, co)
    };
    let (s0, c0) = half(init("INIT0"), p("INJECT1_0") != "NO", [get("A0"), get("B0"), get("C0"), get("D0")], get("CIN"));
    let (s1, c1) = half(init("INIT1"), p("INJECT1_1") != "NO", [get("A1"), get("B1"), get("C1"), get("D1")], c0);
    (s0, s1, c1)
}

/// combinational cells in topological order (every cell after the cells driving its inputs)
fn topo(cells: Vec<Cell>) -> Vec<Cell> {
    let mut driver: HashMap<u32, usize> = HashMap::new();
    for (i, c) in cells.iter().enumerate() {
        for (p, b) in &c.conns { if let (true, Bit::W(w)) = (is_out(p), b) { driver.insert(*w, i); } }
    }
    let mut state = vec![0u8; cells.len()];
    let mut order = vec![];
    for i in 0..cells.len() {
        // iterative depth-first post-order
        let mut stack = vec![(i, false)];
        while let Some((k, done)) = stack.pop() {
            if done { state[k] = 2; order.push(k); continue; }
            if state[k] != 0 { continue; }
            state[k] = 1;
            stack.push((k, true));
            for (p, b) in &cells[k].conns {
                if let (false, Bit::W(w)) = (is_out(p), b) {
                    if let Some(&d) = driver.get(w) { if state[d] == 0 { stack.push((d, false)); } }
                }
            }
        }
    }
    let mut slots: Vec<Option<Cell>> = cells.into_iter().map(Some).collect();
    order.into_iter().map(|i| slots[i].take().unwrap()).collect()
}
