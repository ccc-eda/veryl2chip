//! Technology mapping for Lattice iCE40: the generic gate netlist becomes
//! `SB_LUT4` cells (cut-based 4-input LUT covering, depth then area flow),
//! `SB_CARRY` for ripple-carry adder/comparator chains, and the `SB_DFF*`
//! flip-flop family, i.e. what nextpnr-ice40 expects.

use crate::netlist::*;
use std::collections::HashMap;

type R<T> = Result<T, String>;

const K: usize = 4;
const CUTS: usize = 16;

#[derive(Clone)]
struct Cut {
    leaves: Vec<u32>, // sorted wire ids
    depth: u32,
    flow: f32,
}

/// truth-table patterns of LUT inputs I0..I3
const PAT: [u16; 4] = [0xAAAA, 0xCCCC, 0xF0F0, 0xFF00];

pub fn map(nl: &Netlist) -> R<Netlist> {
    // synchronous-read memories -> SB_RAM40_4K (they take no part in LUT mapping)
    let inf = crate::bram::infer(nl);
    let nl = &inf.nl;
    // combinational gates by output wire; nl.cells keeps them in topological order
    let gates: Vec<&Cell> = nl.cells.iter().filter(|c| !c.is_ff()).collect();
    let mut node: HashMap<u32, usize> = HashMap::new();
    for (i, c) in gates.iter().enumerate() {
        if let Bit::W(w) = c.out() { node.insert(w, i); }
    }
    let fanins = |c: &Cell| -> Vec<Bit> { c.conns.iter().filter(|(p, _)| !is_out(p)).map(|(_, b)| *b).collect() };

    // full-adder carries (a & b) | ((a ^ b) & c) go to the dedicated carry
    // chain; their outputs are leaves for LUT mapping, their a/b/c are roots
    let gate_of = |b: Bit| -> Option<&Cell> { if let Bit::W(w) = b { node.get(&w).map(|i| gates[*i]) } else { None } };
    let pins = |c: &Cell| (c.port("A").unwrap(), c.port("B").unwrap());
    let mut carry: HashMap<u32, (Bit, Bit, Bit)> = HashMap::new();
    for c in &gates {
        if c.typ != "$_OR_" { continue; }
        let (u, v) = pins(c);
        for (g, t) in [(u, v), (v, u)] {
            let (Some(g), Some(t)) = (gate_of(g), gate_of(t)) else { continue };
            if g.typ != "$_AND_" || t.typ != "$_AND_" { continue; }
            let (x, y) = pins(g);
            let (t0, t1) = pins(t);
            for (p, ci) in [(t0, t1), (t1, t0)] {
                if let Some(px) = gate_of(p).filter(|g| g.typ == "$_XOR_") {
                    let (p0, p1) = pins(px);
                    if (p0, p1) == (x, y) || (p1, p0) == (x, y) {
                        if let Bit::W(n) = c.out() { carry.insert(n, (x, y, ci)); }
                    }
                }
            }
        }
    }
    for n in carry.keys() { node.remove(n); }

    // roots: everything sequential logic and output ports look at
    let mut roots: Vec<Bit> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.clone()).collect();
    for c in nl.cells.iter().filter(|c| c.is_ff()).chain(&inf.rams) {
        for (p, b) in &c.conns { if !is_out(p) { roots.push(*b); } }
    }

    // fanout counts (for area flow)
    let mut refs: HashMap<u32, u32> = HashMap::new();
    for c in &gates { for b in fanins(c) { if let Bit::W(w) = b { *refs.entry(w).or_default() += 1; } } }
    for b in &roots { if let Bit::W(w) = b { *refs.entry(*w).or_default() += 1; } }

    let mut best: HashMap<u32, Cut> = HashMap::new();
    let mut cuts: HashMap<u32, Vec<Cut>> = HashMap::new();
    for _pass in 0..2 {
        cuts.clear();
        for c in &gates {
            let Bit::W(n) = c.out() else { continue };
            if carry.contains_key(&n) { continue; }
            // candidate cut sets of each fanin (a leaf wire only has itself)
            let mut sets: Vec<Vec<Vec<u32>>> = vec![];
            for f in fanins(c) {
                let Bit::W(fw) = f else { continue };
                let mut v = vec![vec![fw]];
                if let Some(fc) = cuts.get(&fw) { v.extend(fc.iter().map(|x| x.leaves.clone())); }
                sets.push(v);
            }
            let mut merged: Vec<Vec<u32>> = vec![vec![]];
            for s in &sets {
                let mut next = vec![];
                for m in &merged {
                    for l in s {
                        let mut u = m.clone();
                        for x in l { if !u.contains(x) { u.push(*x); } }
                        if u.len() <= K { next.push(u); }
                    }
                }
                next.sort();
                next.dedup();
                merged = next;
            }
            let mut cand: Vec<Cut> = merged.into_iter().map(|mut leaves| {
                leaves.sort();
                let mut depth = 0;
                let mut flow = 1.0f32;
                for l in &leaves {
                    if let Some(b) = best.get(l) {
                        depth = depth.max(b.depth);
                        flow += b.flow / (*refs.get(l).unwrap_or(&1)).max(1) as f32;
                    }
                }
                Cut { leaves, depth: depth + 1, flow }
            }).collect();
            // drop dominated cuts (a superset of another cut is never better)
            cand.sort_by(|a, b| a.leaves.len().cmp(&b.leaves.len()));
            let mut kept: Vec<Cut> = vec![];
            for c in cand {
                if !kept.iter().any(|k| k.leaves.iter().all(|x| c.leaves.contains(x))) { kept.push(c); }
            }
            kept.sort_by(|a, b| a.depth.cmp(&b.depth).then(a.flow.partial_cmp(&b.flow).unwrap()).then(a.leaves.len().cmp(&b.leaves.len())));
            kept.truncate(CUTS);
            if kept.is_empty() { return Err(format!("no cut for net {}", n)); }
            best.insert(n, kept[0].clone());
            cuts.insert(n, kept);
        }
        // re-estimate fanouts from the current cover for the second pass
        let (used, used_carry) = cover(&roots, &node, &best, &carry);
        refs.clear();
        for n in &used { for l in &best[n].leaves { *refs.entry(*l).or_default() += 1; } }
        for n in &used_carry { let (x, y, c) = carry[n]; for b in [x, y, c] { if let Bit::W(w) = b { *refs.entry(w).or_default() += 1; } } }
        for b in &roots { if let Bit::W(w) = b { *refs.entry(*w).or_default() += 1; } }
    }

    let (used, used_carry) = cover(&roots, &node, &best, &carry);
    // the full gate order (incl. carries) keeps the output topologically sorted
    let pos: HashMap<u32, usize> = gates.iter().enumerate().filter_map(|(i, c)| if let Bit::W(w) = c.out() { Some((w, i)) } else { None }).collect();
    // carry-in by (a, b) pair, to line sum LUTs up with their SB_CARRY:
    // nextpnr packs LUT and carry into one cell when LUT I1/I2 = carry I0/I1 and I3 = CI
    let by_ab: HashMap<(u32, u32), u32> = carry.values().filter_map(|(x, y, c)| match (x, y, c) {
        (Bit::W(a), Bit::W(b), Bit::W(ci)) => Some(((*a.min(b), *a.max(b)), *ci)),
        _ => None,
    }).collect();
    let mut placed: Vec<(usize, Cell)> = vec![];
    for n in used {
        let mut leaves: Vec<Option<u32>> = best[&n].leaves.iter().map(|w| Some(*w)).collect();
        leaves.resize(K, None);
        'pair: for i in 0..K {
            for j in 0..K {
                let (Some(a), Some(b)) = (leaves[i], leaves[j]) else { continue };
                if a >= b { continue; }
                if let Some(ci) = by_ab.get(&(a, b)) {
                    if leaves.contains(&Some(*ci)) {
                        let rest: Vec<Option<u32>> = leaves.iter().copied().filter(|l| *l != Some(a) && *l != Some(b) && *l != Some(*ci)).collect();
                        leaves = vec![rest.first().copied().flatten(), Some(a), Some(b), Some(*ci)];
                        break 'pair;
                    }
                }
            }
        }
        let mut memo: HashMap<u32, u16> = HashMap::new();
        for (i, l) in leaves.iter().enumerate() { if let Some(l) = l { memo.insert(*l, PAT[i]); } }
        let tt = truth(n, &gates, &node, &mut memo);
        let mut conns: Vec<(&'static str, Bit)> = vec![];
        for (i, p) in ["I0", "I1", "I2", "I3"].iter().enumerate() {
            conns.push((p, leaves[i].map(Bit::W).unwrap_or(Bit::C0)));
        }
        conns.push(("O", Bit::W(n)));
        placed.push((pos[&n], Cell { typ: "SB_LUT4".into(), conns, params: vec![("LUT_INIT", format!("{:016b}", tt))] }));
    }
    for n in &used_carry {
        let (x, y, c) = &carry[n];
        placed.push((pos[n], Cell { typ: "SB_CARRY".into(), conns: vec![("I0", *x), ("I1", *y), ("CI", *c), ("CO", Bit::W(*n))], params: vec![] }));
    }
    placed.sort_by_key(|x| x.0);
    let mut cells: Vec<Cell> = placed.into_iter().map(|x| x.1).collect();

    // flip-flops
    let mut inv: HashMap<Bit, Bit> = HashMap::new();
    // (the RAMs' unused RDATA pins got fresh wires too)
    let all_bits = nl.cells.iter().chain(inf.rams.iter()).flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()));
    let mut next_wire = all_bits.filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1;
    for c in nl.cells.iter().filter(|c| c.is_ff()) {
        // $_DFF_P_ / $_DFF_PN0_ / $_SDFF_NP1_ ...
        let t = c.typ.as_str();
        let f: Vec<char> = t.trim_start_matches("$_").trim_start_matches('S').trim_start_matches("DFF_").chars().collect();
        let neg = if f[0] == 'N' { "N" } else { "" };
        let (q, d, ck) = (c.port("Q").unwrap(), c.port("D").unwrap(), c.port("C").unwrap());
        let Some(r) = c.port("R") else {
            cells.push(Cell { typ: format!("SB_DFF{}", neg), conns: vec![("C", ck), ("D", d), ("Q", q)], params: vec![] });
            continue;
        };
        // iCE40 flip-flops only have active-high reset/set: invert in a LUT
        let r = if f[1] == 'N' {
            *inv.entry(r).or_insert_with(|| {
                let y = Bit::W(next_wire);
                next_wire += 1;
                cells.push(Cell { typ: "SB_LUT4".into(), conns: vec![("I0", r), ("I1", Bit::C0), ("I2", Bit::C0), ("I3", Bit::C0), ("O", y)],
                    params: vec![("LUT_INIT", format!("{:016b}", !PAT[0]))] });
                y
            })
        } else { r };
        let sync = if t.starts_with("$_SDFF") { "S" } else { "" };
        let (kind, pin) = if f[2] == '1' { ("S", "S") } else { ("R", "R") };
        cells.push(Cell { typ: format!("SB_DFF{}{}{}", neg, sync, kind), conns: vec![("C", ck), (pin, r), ("D", d), ("Q", q)], params: vec![] });
    }

    cells.extend(inf.rams.iter().cloned());
    // keep only net names whose bits still exist
    let mut live: std::collections::HashSet<Bit> = cells.iter().flat_map(|c| c.conns.iter().filter(|(p, _)| is_out(p)).map(|x| x.1)).collect();
    for p in &nl.ports { live.extend(p.bits.iter().copied()); }
    let nets = nl.nets.iter().filter(|(_, b)| b.iter().all(|x| x.is_const() || live.contains(x))).cloned().collect();
    let ports = nl.ports.iter().map(|p| Port { name: p.name.clone(), dir: p.dir, bits: p.bits.clone() }).collect();
    Ok(Netlist { name: nl.name.clone(), ports, nets, cells })
}

type Set = std::collections::HashSet<u32>;

/// LUT nodes and carries needed to produce `roots`
fn cover(roots: &[Bit], node: &HashMap<u32, usize>, best: &HashMap<u32, Cut>, carry: &HashMap<u32, (Bit, Bit, Bit)>) -> (Set, Set) {
    let (mut used, mut used_carry) = (Set::new(), Set::new());
    let mut work: Vec<u32> = roots.iter().filter_map(|b| if let Bit::W(w) = b { Some(*w) } else { None }).collect();
    while let Some(w) = work.pop() {
        if let Some((x, y, c)) = carry.get(&w) {
            if used_carry.insert(w) {
                work.extend([*x, *y, *c].iter().filter_map(|b| if let Bit::W(v) = b { Some(*v) } else { None }));
            }
            continue;
        }
        if !node.contains_key(&w) || !used.insert(w) { continue; }
        work.extend(best[&w].leaves.iter().copied());
    }
    (used, used_carry)
}

fn truth(w: u32, gates: &[&Cell], node: &HashMap<u32, usize>, memo: &mut HashMap<u32, u16>) -> u16 {
    if let Some(v) = memo.get(&w) { return *v; }
    let c = gates[node[&w]];
    let g = |p: &str, memo: &mut HashMap<u32, u16>| match c.port(p).unwrap() {
        Bit::C0 => 0,
        Bit::C1 => 0xFFFF,
        Bit::W(x) => truth(x, gates, node, memo),
    };
    let v = match c.typ.as_str() {
        "$_NOT_" => !g("A", memo),
        "$_AND_" => g("A", memo) & g("B", memo),
        "$_OR_" => g("A", memo) | g("B", memo),
        "$_XOR_" => g("A", memo) ^ g("B", memo),
        "$_MUX_" => { let (a, b, s) = (g("A", memo), g("B", memo), g("S", memo)); (s & b) | (!s & a) }
        t => panic!("unexpected cell {}", t),
    };
    memo.insert(w, v);
    v
}
