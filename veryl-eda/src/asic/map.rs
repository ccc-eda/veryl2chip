//! Standard-cell technology mapping: tree covering by dynamic programming.
//!
//! The optimized gate netlist ($_NOT_ / $_AND_ / $_OR_ / $_XOR_ / $_MUX_,
//! flip-flops) is cut into fanout-free trees at every gate whose output is
//! used more than once (or by a flip-flop / output port). Each tree is
//! covered with library patterns of minimum total area, so inverters are
//! absorbed into NAND2 / NOR2 / XNOR2 / AOI21 / OAI21 where possible.
//! Synchronous set/reset becomes logic in front of D; asynchronous ones use
//! DFFR / DFFS (active-low pins, with an inverter for active-high resets).
//! Nets with more than MAX_FANOUT data sinks get a tree of BUF cells (the
//! clock and asynchronous set/reset nets are left to clock-tree synthesis).

use super::lib::{area, cell};
use crate::netlist::{is_out, Bit, Builder, Cell, Dir, Netlist};
use std::collections::HashMap;

type R<T> = Result<T, String>;

pub const MAX_FANOUT: usize = 12;

#[derive(Clone, Debug)]
struct Match {
    cell: &'static str,
    /// (pin, leaf)
    leaves: Vec<(&'static str, Bit)>,
    cost: f64,
}

pub fn map(nl: &Netlist) -> R<Netlist> {
    let next = nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()))
        .filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1;
    let mut b = Builder::new();
    b.next_wire = next;
    // ---- flip-flops: (std cell, CK, D, set/reset pin, Q) ----
    let mut ffs: Vec<(&'static str, Bit, Bit, Option<Bit>, Bit)> = vec![];
    let mut gates: Vec<Cell> = vec![];
    for c in &nl.cells {
        if !c.is_ff() { gates.push(c.clone()); continue; }
        let t = c.typ.as_str();
        let f: Vec<char> = t.trim_start_matches("$_").trim_start_matches('S').trim_start_matches("DFF_").chars().collect();
        let neg = f[0] == 'N';
        let (ck, d, q) = (c.port("C").unwrap(), c.port("D").unwrap(), c.out());
        let Some(r) = c.port("R") else {
            ffs.push((if neg { "DFFN" } else { "DFF" }, ck, d, None, q));
            continue;
        };
        let active_high = f[1] == 'P';
        let one = f[2] == '1';
        if t.starts_with("$_SDFF") {
            let act = if active_high { r } else { b.not(r) };
            let d2 = if one { b.or(d, act) } else { let na = b.not(act); b.and(d, na) };
            ffs.push((if neg { "DFFN" } else { "DFF" }, ck, d2, None, q));
        } else {
            let rn = if active_high { b.not(r) } else { r };
            let name = match (neg, one) { (false, false) => "DFFR", (false, true) => "DFFS", (true, false) => "DFFNR", (true, true) => "DFFNS" };
            ffs.push((name, ck, d, Some(rn), q));
        }
    }
    gates.extend(b.cells.iter().cloned());
    let mut next_wire = b.next_wire;

    // ---- the gate network ----
    let mut node: HashMap<Bit, usize> = HashMap::new();
    for (i, g) in gates.iter().enumerate() { node.insert(g.out(), i); }
    let mut fanout: HashMap<Bit, u32> = HashMap::new();
    let mut seq_use: HashMap<Bit, bool> = HashMap::new();
    for g in &gates { for (p, x) in &g.conns { if !is_out(p) { *fanout.entry(*x).or_default() += 1; } } }
    for (_, ck, d, r, _) in &ffs {
        for x in [Some(*ck), Some(*d), *r].into_iter().flatten() { *fanout.entry(x).or_default() += 1; seq_use.insert(x, true); }
    }
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) { for x in &p.bits { *fanout.entry(*x).or_default() += 1; seq_use.insert(*x, true); } }
    // a gate absorbed into its single user's pattern
    let internal = |x: Bit| -> Option<usize> {
        let &i = node.get(&x)?;
        (fanout.get(&x) == Some(&1) && !seq_use.contains_key(&x)).then_some(i)
    };
    let pin = |g: &Cell, p: &str| g.port(p).unwrap();

    // ---- dynamic programming over trees (memoized, iterative) ----
    let mut best: HashMap<usize, Match> = HashMap::new();
    let order = topo(&gates, &node);
    for &i in &order {
        let g = &gates[i];
        let leaf_cost = |x: Bit, best: &HashMap<usize, Match>| -> f64 { internal(x).map(|j| best[&j].cost).unwrap_or(0.0) };
        let mk = |cell_name: &'static str, leaves: Vec<(&'static str, Bit)>, best: &HashMap<usize, Match>| -> Match {
            let cost = area(cell_name) + leaves.iter().map(|(_, x)| leaf_cost(*x, best)).sum::<f64>();
            Match { cell: cell_name, leaves, cost }
        };
        let sub = |x: Bit, typ: &str| -> Option<&Cell> { internal(x).map(|j| &gates[j]).filter(|c| c.typ == typ) };
        let mut cands: Vec<Match> = vec![];
        match g.typ.as_str() {
            "$_NOT_" => {
                let a = pin(g, "A");
                cands.push(mk("INV", vec![("A", a)], &best));
                if let Some(x) = sub(a, "$_AND_") {
                    cands.push(mk("NAND2", vec![("A", pin(x, "A")), ("B", pin(x, "B"))], &best));
                    // !((p|q) & c)
                    for (o, c) in [(pin(x, "A"), pin(x, "B")), (pin(x, "B"), pin(x, "A"))] {
                        if let Some(y) = sub(o, "$_OR_") { cands.push(mk("OAI21", vec![("A", pin(y, "A")), ("B", pin(y, "B")), ("C", c)], &best)); }
                    }
                }
                if let Some(x) = sub(a, "$_OR_") {
                    cands.push(mk("NOR2", vec![("A", pin(x, "A")), ("B", pin(x, "B"))], &best));
                    for (o, c) in [(pin(x, "A"), pin(x, "B")), (pin(x, "B"), pin(x, "A"))] {
                        if let Some(y) = sub(o, "$_AND_") { cands.push(mk("AOI21", vec![("A", pin(y, "A")), ("B", pin(y, "B")), ("C", c)], &best)); }
                    }
                }
                if let Some(x) = sub(a, "$_XOR_") { cands.push(mk("XNOR2", vec![("A", pin(x, "A")), ("B", pin(x, "B"))], &best)); }
            }
            "$_AND_" => {
                let (a, bb) = (pin(g, "A"), pin(g, "B"));
                cands.push(mk("AND2", vec![("A", a), ("B", bb)], &best));
                if let (Some(x), Some(y)) = (sub(a, "$_NOT_"), sub(bb, "$_NOT_")) { cands.push(mk("NOR2", vec![("A", pin(x, "A")), ("B", pin(y, "A"))], &best)); }
            }
            "$_OR_" => {
                let (a, bb) = (pin(g, "A"), pin(g, "B"));
                cands.push(mk("OR2", vec![("A", a), ("B", bb)], &best));
                if let (Some(x), Some(y)) = (sub(a, "$_NOT_"), sub(bb, "$_NOT_")) { cands.push(mk("NAND2", vec![("A", pin(x, "A")), ("B", pin(y, "A"))], &best)); }
            }
            "$_XOR_" => {
                let (a, bb) = (pin(g, "A"), pin(g, "B"));
                cands.push(mk("XOR2", vec![("A", a), ("B", bb)], &best));
                if let Some(x) = sub(a, "$_NOT_") { cands.push(mk("XNOR2", vec![("A", pin(x, "A")), ("B", bb)], &best)); }
                else if let Some(y) = sub(bb, "$_NOT_") { cands.push(mk("XNOR2", vec![("A", a), ("B", pin(y, "A"))], &best)); }
            }
            "$_MUX_" => cands.push(mk("MUX2", vec![("A", pin(g, "A")), ("B", pin(g, "B")), ("S", pin(g, "S"))], &best)),
            t => return Err(format!("standard-cell mapping: unexpected cell {}", t)),
        }
        let m = cands.into_iter().min_by(|x, y| x.cost.partial_cmp(&y.cost).unwrap()).unwrap();
        best.insert(i, m);
    }

    // ---- emit cells for every tree root ----
    let mut cells: Vec<Cell> = vec![];
    let mut ties: HashMap<Bit, Bit> = HashMap::new();
    let mut tie = |v: Bit, cells: &mut Vec<Cell>, next_wire: &mut u32| -> Bit {
        *ties.entry(v).or_insert_with(|| {
            let w = Bit::W(*next_wire);
            *next_wire += 1;
            cells.push(Cell { typ: if v == Bit::C1 { "TIEH" } else { "TIEL" }.into(), conns: vec![("Y", w)], params: vec![] });
            w
        })
    };
    let mut done = vec![false; gates.len()];
    for &root in order.iter().rev() {
        let out = gates[root].out();
        if internal(out).is_some() || done[root] || !fanout.contains_key(&out) { continue; }
        let mut stack = vec![root];
        while let Some(i) = stack.pop() {
            if done[i] { continue; }
            done[i] = true;
            let m = &best[&i];
            let mut conns: Vec<(&'static str, Bit)> = vec![];
            for (p, x) in &m.leaves {
                let x = if x.is_const() { tie(*x, &mut cells, &mut next_wire) } else { *x };
                if let Some(j) = internal(x) { stack.push(j); }
                conns.push((p, x));
            }
            conns.push(("Y", gates[i].out()));
            cells.push(Cell { typ: m.cell.into(), conns, params: vec![] });
        }
    }
    for (name, ck, d, r, q) in ffs {
        let lib = cell(name);
        let mut conns = vec![];
        for (k, p) in lib.ins.iter().enumerate() {
            let x = match k { 0 => ck, 1 => d, _ => r.unwrap() };
            let x = if x.is_const() { tie(x, &mut cells, &mut next_wire) } else { x };
            conns.push((*p, x));
        }
        conns.push(("Q", q));
        cells.push(Cell { typ: name.into(), conns, params: vec![] });
    }
    // constant output ports
    let mut ports = vec![];
    for p in &nl.ports {
        let bits = p.bits.iter().map(|x| if p.dir == Dir::Out && x.is_const() { tie(*x, &mut cells, &mut next_wire) } else { *x }).collect();
        ports.push(crate::netlist::Port { name: p.name.clone(), dir: p.dir, bits });
    }
    buffer(&mut cells, &mut next_wire);
    // topological order (constants first, flip-flops last), as the netlist users expect
    let (seqs, comb): (Vec<Cell>, Vec<Cell>) = cells.into_iter().partition(|c| c.is_ff());
    let cnode: HashMap<Bit, usize> = comb.iter().enumerate().map(|(i, c)| (c.out(), i)).collect();
    let ord = topo(&comb, &cnode);
    let mut cells: Vec<Cell> = ord.into_iter().map(|i| comb[i].clone()).collect();
    cells.extend(seqs);
    let live: std::collections::HashSet<Bit> = cells.iter().map(|c| c.out()).chain(ports.iter().flat_map(|p| p.bits.iter().copied())).collect();
    let nets = nl.nets.iter().filter(|(_, b)| b.iter().all(|x| x.is_const() || live.contains(x))).cloned().collect();
    Ok(Netlist { name: nl.name.clone(), ports, nets, cells })
}

/// gate indices in topological order (inputs first)
fn topo(gates: &[Cell], node: &HashMap<Bit, usize>) -> Vec<usize> {
    let mut state = vec![0u8; gates.len()];
    let mut out = vec![];
    for s in 0..gates.len() {
        if state[s] != 0 { continue; }
        let mut stack = vec![(s, false)];
        while let Some((i, done)) = stack.pop() {
            if done { if state[i] != 2 { state[i] = 2; out.push(i); } continue; }
            if state[i] != 0 { continue; }
            state[i] = 1;
            stack.push((i, true));
            for (p, x) in &gates[i].conns {
                if is_out(p) { continue; }
                if let Some(&j) = node.get(x) { if state[j] == 0 { stack.push((j, false)); } }
            }
        }
    }
    out
}

/// split every data net with more than MAX_FANOUT sink pins into a BUF tree
/// (sinks are grouped in netlist order, which keeps connected logic together)
fn buffer(cells: &mut Vec<Cell>, next_wire: &mut u32) {
    let mut sinks: HashMap<Bit, Vec<(usize, usize)>> = HashMap::new();
    let mut order: Vec<Bit> = vec![];
    for (i, c) in cells.iter().enumerate() {
        for (k, (p, b)) in c.conns.iter().enumerate() {
            if is_out(p) || b.is_const() || matches!(*p, "CK" | "RN" | "SN") { continue; }
            sinks.entry(*b).or_insert_with(|| { order.push(*b); vec![] }).push((i, k));
        }
    }
    for b in order {
        let mut level = sinks.remove(&b).unwrap();
        while level.len() > MAX_FANOUT {
            let mut next = vec![];
            for group in level.chunks(MAX_FANOUT) {
                let w = Bit::W(*next_wire);
                *next_wire += 1;
                for &(i, k) in group { cells[i].conns[k].1 = w; }
                next.push((cells.len(), 0));
                cells.push(Cell { typ: "BUF".into(), conns: vec![("A", b), ("Y", w)], params: vec![] });
            }
            level = next;
        }
    }
}
