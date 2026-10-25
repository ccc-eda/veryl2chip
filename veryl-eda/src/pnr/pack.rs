//! Packing: SB_LUT4 / SB_CARRY / SB_DFF* cells into iCE40 logic cells (LCs).
//!
//! An LC is a 4-input LUT, a carry unit (inputs hardwired to the LUT's
//! in_1/in_2, carry-in from the LC below) and a flip-flop fed by the LUT.
//! Carry chains occupy consecutive LCs of one column; a chain whose carry-in
//! is an ordinary signal gets a feed-in LC (carry of CI & CI with carry-in 0
//! = CI), and a carry-out needed by ordinary logic is read back through the
//! LUT of the next LC (`in_3` = carry-in, LUT = pass-through).

use crate::netlist::{is_out, Bit, Cell, Dir, Netlist};
use std::collections::{HashMap, HashSet, VecDeque};

type R<T> = Result<T, String>;

#[derive(Clone, Debug, PartialEq)]
pub struct Ff {
    pub clk: Bit,
    pub sr: Option<Bit>,
    pub neg: bool,
    /// value on set/reset
    pub set: bool,
    pub asynch: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Lc {
    /// nets on in_0..in_3 (None = unused); in_1/in_2 also feed the carry
    pub ins: [Option<Bit>; 4],
    /// in_3 comes from the carry chain instead of routing
    pub in3_chain: bool,
    pub init: u16,
    pub carry: bool,
    pub ff: Option<Ff>,
    /// net driven by lutff_z/out
    pub out: Option<Bit>,
}

pub struct Chain {
    pub lcs: Vec<usize>,
    /// constant carry-in of the first LC
    pub cin: bool,
}

pub struct Io {
    pub name: String,
    pub dir: Dir,
    pub net: Bit,
}

pub struct Packed {
    pub lcs: Vec<Lc>,
    pub chains: Vec<Chain>,
    pub ios: Vec<Io>,
}

const PASS: [u16; 4] = [0xAAAA, 0xCCCC, 0xF0F0, 0xFF00];

/// make the LUT independent of unused inputs (they are left unrouted)
pub fn canon(lc: &mut Lc) {
    for k in 0..4 {
        if lc.ins[k].is_none() && !(k == 3 && lc.in3_chain) {
            let mut v = 0u16;
            for i in 0..16 { v |= ((lc.init >> (i & !(1 << k))) & 1) << i; }
            lc.init = v;
        }
    }
}

/// fold constant inputs into the truth table
fn fold_consts(ins: &mut [Option<Bit>; 4], init: &mut u16) {
    for k in 0..4 {
        let v = match ins[k] { Some(Bit::C0) => 0, Some(Bit::C1) => 1, _ => continue };
        let mut t = 0u16;
        for i in 0..16 { t |= ((*init >> ((i & !(1 << k)) | (v << k))) & 1) << i; }
        *init = t;
        ins[k] = None;
    }
}

fn swap_inputs(init: u16, a: usize, b: usize) -> u16 {
    let mut t = 0u16;
    for i in 0..16usize {
        let j = (i & !(1 << a) & !(1 << b)) | (((i >> b) & 1) << a) | (((i >> a) & 1) << b);
        t |= ((init >> j) & 1) << i;
    }
    t
}

fn init_of(c: &Cell) -> u16 {
    u16::from_str_radix(&c.params.iter().find(|p| p.0 == "LUT_INIT").unwrap().1, 2).unwrap()
}

/// SB_DFF[N][S]{R,S} -> (negedge, sync, reset pin and value)
fn ff_kind(t: &str) -> R<(bool, bool, Option<(&'static str, bool)>)> {
    let k = t.strip_prefix("SB_DFF").ok_or_else(|| format!("not a flip-flop: {}", t))?;
    let neg = k.starts_with('N');
    let k = k.trim_start_matches('N');
    let (sync, k) = if k.len() == 2 { (true, &k[1..]) } else { (false, k) };
    Ok((neg, sync, match k { "" => None, "R" => Some(("R", false)), "S" => Some(("S", true)), _ => return Err(format!("unknown flip-flop {}", t)) }))
}

struct Ctx {
    cells: Vec<Cell>,
    users: HashMap<Bit, Vec<(usize, &'static str)>>,
    next: u32,
}

impl Ctx {
    fn fresh(&mut self) -> Bit { self.next += 1; Bit::W(self.next - 1) }
    /// move the uses of `from` that `keep` rejects to the net `to`
    fn rewire(&mut self, from: Bit, to: Bit, keep: &dyn Fn(usize, &str) -> bool) {
        let us = self.users.remove(&from).unwrap_or_default();
        let (mut stay, mut moved) = (vec![], vec![]);
        for (u, p) in us {
            if keep(u, p) { stay.push((u, p)); continue; }
            for conn in self.cells[u].conns.iter_mut() { if conn.0 == p && conn.1 == from { conn.1 = to; } }
            moved.push((u, p));
        }
        self.users.insert(from, stay);
        self.users.entry(to).or_default().extend(moved);
    }
}

pub fn pack(nl: &Netlist) -> R<Packed> {
    let next = nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()))
        .filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1;
    let mut cx = Ctx { cells: nl.cells.clone(), users: HashMap::new(), next };
    for (i, c) in cx.cells.iter().enumerate() {
        for (p, b) in &c.conns { if !is_out(p) { cx.users.entry(*b).or_default().push((i, p)); } }
    }
    let mut port_bits: Vec<(String, Dir, Bit)> = vec![];
    for p in &nl.ports {
        for (i, b) in p.bits.iter().enumerate() {
            let name = if p.bits.len() == 1 { p.name.clone() } else { format!("{}[{}]", p.name, i) };
            port_bits.push((name, p.dir, *b));
        }
    }
    let ported = |b: Bit, pb: &Vec<(String, Dir, Bit)>| pb.iter().any(|(_, d, x)| *d == Dir::Out && *x == b);
    let driver: HashMap<Bit, usize> = cx.cells.iter().enumerate().map(|(i, c)| (c.out(), i)).collect();

    let carries: Vec<usize> = (0..cx.cells.len()).filter(|i| cx.cells[*i].typ == "SB_CARRY").collect();
    // the carry consuming each carry-out as its carry-in
    let mut next_c: HashMap<usize, usize> = HashMap::new();
    let mut has_prev: HashSet<usize> = HashSet::new();
    for &c in &carries {
        if let Some(&d) = driver.get(&cx.cells[c].port("CI").unwrap()) {
            if cx.cells[d].typ == "SB_CARRY" && !next_c.contains_key(&d) { next_c.insert(d, c); has_prev.insert(c); }
        }
    }
    // the sum LUT of each carry: I1/I2 = carry inputs, I3 = carry-in
    let mut sum_lut: HashMap<usize, usize> = HashMap::new();
    let mut taken: HashSet<usize> = HashSet::new();
    for &c in &carries {
        let cc = &cx.cells[c];
        let (a, b, ci) = (cc.port("I0").unwrap(), cc.port("I1").unwrap(), cc.port("CI").unwrap());
        for &(u, pin) in cx.users.get(&ci).map(|v| v.as_slice()).unwrap_or(&[]) {
            let l = &cx.cells[u];
            if pin != "I3" || l.typ != "SB_LUT4" || taken.contains(&u) { continue; }
            let (i1, i2) = (l.port("I1").unwrap(), l.port("I2").unwrap());
            if (i1, i2) == (a, b) || (i1, i2) == (b, a) { sum_lut.insert(c, u); taken.insert(u); break; }
        }
    }

    let mut lcs: Vec<Lc> = vec![];
    let mut chains: Vec<Chain> = vec![];
    let lut_lc = |c: &Cell| -> Lc {
        let mut ins = [c.port("I0"), c.port("I1"), c.port("I2"), c.port("I3")];
        let mut init = init_of(c);
        fold_consts(&mut ins, &mut init);
        Lc { ins, init, out: Some(c.out()), ..Default::default() }
    };

    // ---- carry chains ----
    let mut work: VecDeque<usize> = carries.iter().copied().filter(|c| !has_prev.contains(c)).collect();
    let mut done: HashSet<usize> = HashSet::new();
    while let Some(start) = work.pop_front() {
        if !done.insert(start) { continue; }
        let mut chain = Chain { lcs: vec![], cin: false };
        match cx.cells[start].port("CI").unwrap() {
            Bit::C0 => {}
            Bit::C1 => chain.cin = true,
            ci => {
                chain.lcs.push(lcs.len());
                lcs.push(Lc { ins: [None, Some(ci), Some(ci), None], carry: true, ..Default::default() });
            }
        }
        let mut cur = start;
        let mut pass_out: Option<Bit> = None; // this LC's LUT reads the carry-in out to this net
        loop {
            done.insert(cur);
            let (a, b) = (cx.cells[cur].port("I0").unwrap(), cx.cells[cur].port("I1").unwrap());
            let mut lc = match (pass_out.take(), sum_lut.get(&cur)) {
                (Some(fo), _) => Lc { in3_chain: true, init: PASS[3], out: Some(fo), ..Default::default() },
                (None, Some(&u)) => {
                    let mut l = lut_lc(&cx.cells[u]);
                    if l.ins[1] != Some(a) { l.ins.swap(1, 2); l.init = swap_inputs(l.init, 1, 2); }
                    l.ins[3] = None;
                    l.in3_chain = true;
                    l
                }
                (None, None) => Lc::default(),
            };
            lc.ins[1] = Some(a);
            lc.ins[2] = Some(b);
            lc.carry = true;
            chain.lcs.push(lcs.len());
            lcs.push(lc);

            let co = cx.cells[cur].out();
            let nxt = next_c.get(&cur).copied().filter(|n| !done.contains(n));
            let nsum = nxt.and_then(|n| sum_lut.get(&n).copied());
            let keep = move |u: usize, p: &str| Some(u) == nxt || (Some(u) == nsum && p == "I3");
            let ext = cx.users.get(&co).map(|us| us.iter().any(|(u, p)| !keep(*u, p))).unwrap_or(false) || ported(co, &port_bits);
            if !ext {
                match nxt { Some(n) => { cur = n; continue } None => break }
            }
            // the carry-out is needed by ordinary logic: read it out through
            // the next LC's LUT; a sum LUT that was going there moves to its
            // own LC and reads the carry back from routing (the chain itself
            // stays unbroken, which keeps the carry path fast)
            let fo = cx.fresh();
            for pb in port_bits.iter_mut() { if pb.2 == co { pb.2 = fo; } }
            match nxt {
                Some(n) => {
                    cx.rewire(co, fo, &move |u, _| u == n);
                    if let Some(u) = nsum { sum_lut.remove(&n); taken.remove(&u); }
                    pass_out = Some(fo);
                    cur = n;
                }
                None => {
                    cx.rewire(co, fo, &|_, _| false);
                    chain.lcs.push(lcs.len());
                    lcs.push(Lc { in3_chain: true, init: PASS[3], out: Some(fo), ..Default::default() });
                    break;
                }
            }
        }
        chains.push(chain);
    }

    // ---- LUTs, then flip-flops (merged into their LUT when possible) ----
    let mut lc_of_out: HashMap<Bit, usize> = HashMap::new();
    for (i, c) in cx.cells.iter().enumerate() {
        if c.typ == "SB_LUT4" && !taken.contains(&i) {
            lc_of_out.insert(c.out(), lcs.len());
            lcs.push(lut_lc(c));
        }
    }
    for c in cx.cells.iter().filter(|c| c.typ.starts_with("SB_DFF")) {
        let (neg, sync, rs) = ff_kind(&c.typ)?;
        let ff = Ff {
            clk: c.port("C").unwrap(),
            sr: rs.map(|(p, _)| c.port(p).unwrap()),
            neg,
            set: rs.map(|x| x.1).unwrap_or(false),
            asynch: !sync,
        };
        if ff.sr == Some(Bit::C0) { return Err("flip-flop with constant reset".into()); }
        let d = c.port("D").unwrap();
        let q = c.out();
        let sole = cx.users.get(&d).map(|u| u.len() == 1).unwrap_or(false) && !ported(d, &port_bits);
        if let Some(&l) = lc_of_out.get(&d).filter(|_| sole) {
            if lcs[l].ff.is_none() {
                lcs[l].ff = Some(ff);
                lcs[l].out = Some(q);
                lc_of_out.remove(&d);
                continue;
            }
        }
        let mut lc = Lc { ff: Some(ff), out: Some(q), ..Default::default() };
        match d {
            Bit::C0 => lc.init = 0,
            Bit::C1 => lc.init = 0xFFFF,
            _ => { lc.ins[0] = Some(d); lc.init = PASS[0]; }
        }
        lcs.push(lc);
    }

    // ---- constants that must be routed: driven by a constant LUT ----
    let mut konst: HashMap<Bit, Bit> = HashMap::new();
    let mut const_net = |v: Bit, lcs: &mut Vec<Lc>, cx: &mut Ctx| -> Bit {
        *konst.entry(v).or_insert_with(|| {
            let n = cx.fresh();
            lcs.push(Lc { init: if v == Bit::C1 { 0xFFFF } else { 0 }, out: Some(n), ..Default::default() });
            n
        })
    };
    for i in 0..lcs.len() {
        for k in 0..4 {
            if let Some(b @ (Bit::C0 | Bit::C1)) = lcs[i].ins[k] {
                let n = const_net(b, &mut lcs, &mut cx);
                lcs[i].ins[k] = Some(n);
            }
        }
    }
    let mut ios = vec![];
    for (name, dir, b) in port_bits {
        let net = if b.is_const() { const_net(b, &mut lcs, &mut cx) } else { b };
        ios.push(Io { name, dir, net });
    }
    for lc in lcs.iter_mut() { canon(lc); }
    Ok(Packed { lcs, chains, ios })
}
