//! Gate-level netlist IR and a bit-level builder with hash-consing and
//! constant folding. Cell types follow yosys internal gate cell naming
//! (`$_AND_`, `$_MUX_`, `$_DFF_P_`, ...) so the emitted JSON is directly
//! consumable by yosys / nextpnr.

use std::collections::{HashMap, HashSet};

type R<T> = Result<T, String>;

/// A single bit: compile-time constant or a wire (net id >= 2, as in yosys JSON).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Bit {
    C0,
    C1,
    W(u32),
}

impl Bit {
    pub fn is_const(self) -> bool { !matches!(self, Bit::W(_)) }
    pub fn of(b: bool) -> Bit { if b { Bit::C1 } else { Bit::C0 } }
}

#[derive(Clone, Debug)]
pub struct Cell {
    pub typ: String,
    /// (port name, bit); the output port is "Y" (gates) or "Q" (flip-flops)
    pub conns: Vec<(&'static str, Bit)>,
}

impl Cell {
    pub fn out(&self) -> Bit {
        self.conns.iter().find(|(p, _)| *p == "Y" || *p == "Q").map(|(_, b)| *b).unwrap()
    }
    pub fn is_ff(&self) -> bool { self.conns.iter().any(|(p, _)| *p == "Q") }
    pub fn port(&self, name: &str) -> Option<Bit> {
        self.conns.iter().find(|(p, _)| *p == name).map(|(_, b)| *b)
    }
}

pub struct Builder {
    pub cells: Vec<Cell>,
    pub next_wire: u32,
    cache: HashMap<(&'static str, [Bit; 3]), Bit>,
    /// x <-> !x, so that double negation and x & !x fold away
    inv: HashMap<Bit, Bit>,
}

impl Default for Builder {
    fn default() -> Self { Builder::new() }
}

impl Builder {
    pub fn new() -> Self {
        Builder { cells: vec![], next_wire: 2, cache: HashMap::new(), inv: HashMap::new() }
    }

    pub fn wire(&mut self) -> Bit {
        let w = self.next_wire;
        self.next_wire += 1;
        Bit::W(w)
    }
    pub fn wires(&mut self, n: u32) -> Vec<Bit> { (0..n).map(|_| self.wire()).collect() }

    fn gate(&mut self, typ: &'static str, ins: &[(&'static str, Bit)]) -> Bit {
        let mut key = [Bit::C0; 3];
        for (k, (_, b)) in ins.iter().enumerate() { key[k] = *b; }
        if let Some(&y) = self.cache.get(&(typ, key)) { return y; }
        let y = self.wire();
        let mut conns = ins.to_vec();
        conns.push(("Y", y));
        self.cells.push(Cell { typ: typ.to_string(), conns });
        self.cache.insert((typ, key), y);
        y
    }

    pub fn ff(&mut self, typ: String, conns: Vec<(&'static str, Bit)>) {
        self.cells.push(Cell { typ, conns });
    }

    // ---------- single-bit gates (with constant folding) ----------
    pub fn not(&mut self, a: Bit) -> Bit {
        match a {
            Bit::C0 => Bit::C1,
            Bit::C1 => Bit::C0,
            _ => {
                if let Some(&n) = self.inv.get(&a) { return n; }
                let y = self.gate("$_NOT_", &[("A", a)]);
                self.inv.insert(a, y);
                self.inv.insert(y, a);
                y
            }
        }
    }
    fn is_inv(&self, a: Bit, b: Bit) -> bool { self.inv.get(&a) == Some(&b) }

    pub fn and(&mut self, a: Bit, b: Bit) -> Bit {
        match (a, b) {
            (Bit::C0, _) | (_, Bit::C0) => Bit::C0,
            (Bit::C1, x) | (x, Bit::C1) => x,
            _ if a == b => a,
            _ if self.is_inv(a, b) => Bit::C0,
            _ => { let (x, y) = (a.min(b), a.max(b)); self.gate("$_AND_", &[("A", x), ("B", y)]) }
        }
    }
    pub fn or(&mut self, a: Bit, b: Bit) -> Bit {
        match (a, b) {
            (Bit::C1, _) | (_, Bit::C1) => Bit::C1,
            (Bit::C0, x) | (x, Bit::C0) => x,
            _ if a == b => a,
            _ if self.is_inv(a, b) => Bit::C1,
            _ => { let (x, y) = (a.min(b), a.max(b)); self.gate("$_OR_", &[("A", x), ("B", y)]) }
        }
    }
    pub fn xor(&mut self, a: Bit, b: Bit) -> Bit {
        match (a, b) {
            (Bit::C0, x) | (x, Bit::C0) => x,
            (Bit::C1, x) | (x, Bit::C1) => self.not(x),
            _ if a == b => Bit::C0,
            _ if self.is_inv(a, b) => Bit::C1,
            _ => { let (x, y) = (a.min(b), a.max(b)); self.gate("$_XOR_", &[("A", x), ("B", y)]) }
        }
    }
    pub fn xnor(&mut self, a: Bit, b: Bit) -> Bit { let x = self.xor(a, b); self.not(x) }

    /// Y = S ? B : A  (yosys `$_MUX_` semantics)
    pub fn mux(&mut self, s: Bit, a: Bit, b: Bit) -> Bit {
        if a == b { return a; }
        match (s, a, b) {
            (Bit::C0, _, _) => a,
            (Bit::C1, _, _) => b,
            (_, Bit::C0, Bit::C1) => s,
            (_, Bit::C1, Bit::C0) => self.not(s),
            (_, Bit::C0, _) => self.and(s, b),
            (_, _, Bit::C1) => self.or(s, a),
            (_, Bit::C1, _) => { let ns = self.not(s); self.or(ns, b) }
            (_, _, Bit::C0) => { let ns = self.not(s); self.and(ns, a) }
            _ => self.gate("$_MUX_", &[("A", a), ("B", b), ("S", s)]),
        }
    }

    // ---------- multi-bit (lsb-first vectors) ----------
    pub fn muxv(&mut self, s: Bit, a: &[Bit], b: &[Bit]) -> Vec<Bit> {
        let w = a.len().max(b.len());
        (0..w).map(|i| self.mux(s, at(a, i), at(b, i))).collect()
    }
    pub fn notv(&mut self, a: &[Bit]) -> Vec<Bit> { a.iter().map(|x| self.not(*x)).collect() }

    pub fn reduce_or(&mut self, a: &[Bit]) -> Bit { a.iter().fold(Bit::C0, |acc, x| self.or(acc, *x)) }
    pub fn reduce_and(&mut self, a: &[Bit]) -> Bit { a.iter().fold(Bit::C1, |acc, x| self.and(acc, *x)) }
    pub fn reduce_xor(&mut self, a: &[Bit]) -> Bit { a.iter().fold(Bit::C0, |acc, x| self.xor(acc, *x)) }

    /// ripple-carry adder over equal-width vectors; returns (sum, carry out)
    pub fn add_c(&mut self, a: &[Bit], b: &[Bit], cin: Bit) -> (Vec<Bit>, Bit) {
        let mut c = cin;
        let mut out = Vec::with_capacity(a.len());
        for i in 0..a.len().max(b.len()) {
            let (x, y) = (at(a, i), at(b, i));
            let p = self.xor(x, y);
            out.push(self.xor(p, c));
            let g = self.and(x, y);
            let pc = self.and(p, c);
            c = self.or(g, pc);
        }
        (out, c)
    }
    pub fn add(&mut self, a: &[Bit], b: &[Bit]) -> Vec<Bit> { self.add_c(a, b, Bit::C0).0 }
    pub fn sub(&mut self, a: &[Bit], b: &[Bit]) -> Vec<Bit> {
        let w = a.len().max(b.len());
        let nb = self.notv(&pad(b, w));
        self.add_c(&pad(a, w), &nb, Bit::C1).0
    }
    pub fn neg(&mut self, a: &[Bit]) -> Vec<Bit> { self.sub(&vec![Bit::C0; a.len()], a) }

    /// shift-and-add array multiplier, truncated to the operand width
    pub fn mul(&mut self, a: &[Bit], b: &[Bit]) -> Vec<Bit> {
        let w = a.len().max(b.len());
        let mut acc = vec![Bit::C0; w];
        for i in 0..w {
            let bi = at(b, i);
            if bi == Bit::C0 { continue; }
            let mut pp = vec![Bit::C0; w];
            for j in 0..w - i { pp[i + j] = self.and(at(a, j), bi); }
            acc = self.add(&acc, &pp);
        }
        acc
    }

    pub fn eq(&mut self, a: &[Bit], b: &[Bit]) -> Bit {
        let w = a.len().max(b.len());
        let bits: Vec<Bit> = (0..w).map(|i| self.xnor(at(a, i), at(b, i))).collect();
        self.reduce_and(&bits)
    }
    /// unsigned a < b: no carry out of a + ~b + 1
    pub fn ult(&mut self, a: &[Bit], b: &[Bit]) -> Bit {
        let w = a.len().max(b.len());
        let nb = self.notv(&pad(b, w));
        let (_, c) = self.add_c(&pad(a, w), &nb, Bit::C1);
        self.not(c)
    }
    /// signed a < b: flip the sign bits, then compare unsigned
    pub fn slt(&mut self, a: &[Bit], b: &[Bit]) -> Bit {
        let w = a.len().max(b.len());
        let (mut x, mut y) = (sext(a, w), sext(b, w));
        if w > 0 {
            x[w - 1] = self.not(x[w - 1]);
            y[w - 1] = self.not(y[w - 1]);
        }
        self.ult(&x, &y)
    }

    /// logarithmic barrel shifter; `fill` enters from the vacated side
    pub fn shift(&mut self, a: &[Bit], amt: &[Bit], left: bool, fill: Bit) -> Vec<Bit> {
        let w = a.len();
        let mut cur = a.to_vec();
        for (k, s) in amt.iter().enumerate() {
            let n = 1usize.checked_shl(k as u32).unwrap_or(usize::MAX);
            let sh = shift_const(&cur, n, left, fill);
            cur = self.muxv(*s, &cur, &sh);
            if n >= w { // further stages saturate: fold the remaining amount bits in
                let rest = self.reduce_or(&amt[k + 1..]);
                let all = vec![fill; w];
                return self.muxv(rest, &cur, &all);
            }
        }
        cur
    }

    /// select element `idx` from `elems` (all the same width); out-of-range -> 0
    pub fn select(&mut self, elems: &[Vec<Bit>], idx: &[Bit]) -> Vec<Bit> {
        if let Some(k) = const_of(idx) {
            return elems.get(k as usize).cloned().unwrap_or_else(|| vec![Bit::C0; elems[0].len()]);
        }
        let need = bits_for(elems.len());
        let mut level: Vec<Vec<Bit>> = elems.to_vec();
        let ew = elems[0].len();
        for j in 0..need {
            let s = at(idx, j);
            let mut next = vec![];
            for p in level.chunks(2) {
                let a = &p[0];
                let b = p.get(1).cloned().unwrap_or_else(|| vec![Bit::C0; ew]);
                next.push(self.muxv(s, a, &b));
            }
            level = next;
        }
        let r = level.pop().unwrap();
        if idx.len() > need {
            let hi = self.reduce_or(&idx[need..]);
            return self.muxv(hi, &r, &vec![Bit::C0; ew]);
        }
        r
    }

    /// one-hot decode: idx == k
    pub fn decode(&mut self, idx: &[Bit], k: usize) -> Bit {
        let kb: Vec<Bit> = (0..idx.len().max(bits_for(k + 1))).map(|i| Bit::of((k >> i) & 1 == 1)).collect();
        self.eq(idx, &kb)
    }
}

pub fn at(v: &[Bit], i: usize) -> Bit { v.get(i).copied().unwrap_or(Bit::C0) }

pub fn pad(a: &[Bit], w: usize) -> Vec<Bit> {
    let mut v = a.to_vec();
    v.resize(w, Bit::C0);
    v
}
/// sign-extend (or truncate) to `w`
pub fn sext(a: &[Bit], w: usize) -> Vec<Bit> {
    let msb = a.last().copied().unwrap_or(Bit::C0);
    let mut v = a.to_vec();
    v.resize(w, msb);
    v
}

pub fn shift_const(a: &[Bit], n: usize, left: bool, fill: Bit) -> Vec<Bit> {
    let w = a.len();
    (0..w).map(|i| {
        if left { if i >= n { a[i - n] } else { fill } } else if i + n < w { a[i + n] } else { fill }
    }).collect()
}

pub fn bits_for(n: usize) -> usize {
    let mut k = 0;
    while (1usize << k) < n { k += 1; }
    k
}

pub fn const_bits(v: u128, w: u32) -> Vec<Bit> {
    (0..w).map(|i| Bit::of(i < 128 && (v >> i) & 1 == 1)).collect()
}

pub fn const_of(bits: &[Bit]) -> Option<u128> {
    let mut v = 0u128;
    for (i, b) in bits.iter().enumerate() {
        match b {
            Bit::C1 if i < 128 => v |= 1 << i,
            Bit::C1 | Bit::C0 => {}
            Bit::W(_) => return None,
        }
    }
    Some(v)
}

// ---------------- the flattened design ----------------

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Dir { In, Out }

pub struct Port { pub name: String, pub dir: Dir, pub bits: Vec<Bit> }

pub struct Netlist {
    pub name: String,
    pub ports: Vec<Port>,
    /// named nets (hierarchical names)
    pub nets: Vec<(String, Vec<Bit>)>,
    /// combinational cells in topological order, then flip-flops
    pub cells: Vec<Cell>,
}

/// Rebuild the netlist after elaboration: resolve placeholder aliases,
/// re-run constant folding / structural hashing over the whole design in
/// topological order (detecting combinational loops), and drop logic that
/// does not reach an output port.
pub fn optimize(b: Builder, alias: &HashMap<u32, Bit>, ports: Vec<Port>, nets: Vec<(String, Vec<Bit>)>, name: &str) -> R<Netlist> {
    let resolve = |mut x: Bit| -> R<Bit> {
        let mut n = 0;
        while let Bit::W(w) = x {
            match alias.get(&w) {
                Some(&y) => x = y,
                None => break,
            }
            n += 1;
            if n > alias.len() + 1 { return Err(format!("combinational loop through net {}", w)); }
        }
        Ok(x)
    };
    let mut driver: HashMap<u32, usize> = HashMap::new();
    for (i, c) in b.cells.iter().enumerate() {
        if !c.is_ff() { if let Bit::W(w) = c.out() { driver.insert(w, i); } }
    }
    let mut nb = Builder::new();
    nb.next_wire = b.next_wire;
    let mut memo: HashMap<u32, Bit> = HashMap::new();
    let net_name = |w: u32| -> String {
        nets.iter().find(|(_, bs)| bs.contains(&Bit::W(w))).map(|(n, _)| n.clone()).unwrap_or_else(|| format!("${}", w))
    };

    // iterative DFS: map(bit) -> rebuilt bit
    let map = |root: Bit, nb: &mut Builder, memo: &mut HashMap<u32, Bit>| -> R<Bit> {
        let root = resolve(root)?;
        let Bit::W(rw) = root else { return Ok(root) };
        if let Some(&m) = memo.get(&rw) { return Ok(m); }
        let mut stack: Vec<(u32, bool)> = vec![(rw, false)];
        let mut onstack: HashSet<u32> = HashSet::new();
        while let Some((w, expanded)) = stack.pop() {
            if memo.contains_key(&w) { continue; }
            let Some(&ci) = driver.get(&w) else { memo.insert(w, Bit::W(w)); continue };
            let c = &b.cells[ci];
            if !expanded {
                if !onstack.insert(w) { return Err(format!("combinational loop through '{}'", net_name(w))); }
                stack.push((w, true));
                for (p, x) in &c.conns {
                    if *p == "Y" { continue; }
                    if let Bit::W(xw) = resolve(*x)? {
                        if memo.contains_key(&xw) { continue; }
                        if onstack.contains(&xw) { return Err(format!("combinational loop through '{}'", net_name(xw))); }
                        stack.push((xw, false));
                    }
                }
                continue;
            }
            onstack.remove(&w);
            let get = |p: &str, memo: &HashMap<u32, Bit>| -> R<Bit> {
                match resolve(c.port(p).unwrap())? { Bit::W(x) => Ok(*memo.get(&x).unwrap_or(&Bit::W(x))), k => Ok(k) }
            };
            let y = match c.typ.as_str() {
                "$_NOT_" => { let a = get("A", memo)?; nb.not(a) }
                "$_AND_" => { let (a, bb) = (get("A", memo)?, get("B", memo)?); nb.and(a, bb) }
                "$_OR_" => { let (a, bb) = (get("A", memo)?, get("B", memo)?); nb.or(a, bb) }
                "$_XOR_" => { let (a, bb) = (get("A", memo)?, get("B", memo)?); nb.xor(a, bb) }
                "$_MUX_" => { let (a, bb, s) = (get("A", memo)?, get("B", memo)?, get("S", memo)?); nb.mux(s, a, bb) }
                t => return Err(format!("unknown cell type {}", t)),
            };
            memo.insert(w, y);
        }
        Ok(memo[&rw])
    };

    let mut ports2 = vec![];
    for p in ports {
        let mut bits = vec![];
        for x in &p.bits { bits.push(if p.dir == Dir::In { *x } else { map(*x, &mut nb, &mut memo)? }); }
        ports2.push(Port { name: p.name, dir: p.dir, bits });
    }
    // flip-flops: inputs are rebuilt, Q stays the same net
    let mut ffs = vec![];
    for c in b.cells.iter().filter(|c| c.is_ff()) {
        let mut conns = vec![];
        for (p, x) in &c.conns {
            conns.push((*p, if *p == "Q" { *x } else { map(*x, &mut nb, &mut memo)? }));
        }
        ffs.push(Cell { typ: c.typ.clone(), conns });
    }
    let mut nets2 = vec![];
    for (n, bits) in nets {
        let mut v = vec![];
        for x in &bits {
            let r = resolve(*x)?;
            v.push(match r { Bit::W(w) => *memo.get(&w).unwrap_or(&r), k => k });
        }
        nets2.push((n, v));
    }
    let mut cells = nb.cells;
    cells.extend(ffs);
    let roots: Vec<Bit> = ports2.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.clone()).collect();
    sweep(&mut cells, &roots);
    Ok(Netlist { name: name.to_string(), ports: ports2, nets: nets2, cells })
}

/// Remove cells whose output reaches no output port (also dead registers).
pub fn sweep(cells: &mut Vec<Cell>, roots: &[Bit]) {
    let mut live: HashSet<Bit> = roots.iter().copied().collect();
    let by_out: HashMap<Bit, usize> = cells.iter().enumerate().map(|(i, c)| (c.out(), i)).collect();
    let mut keep = vec![false; cells.len()];
    let mut work: Vec<Bit> = roots.to_vec();
    while let Some(x) = work.pop() {
        if let Some(&i) = by_out.get(&x) {
            if keep[i] { continue; }
            keep[i] = true;
            for (p, y) in &cells[i].conns {
                if *p != "Y" && *p != "Q" && y.is_const() == false && live.insert(*y) { work.push(*y); }
            }
        }
    }
    let mut i = 0;
    cells.retain(|_| { i += 1; keep[i - 1] });
}

impl Netlist {
    pub fn stats(&self) -> Vec<(String, usize)> {
        let mut m: HashMap<String, usize> = HashMap::new();
        for c in &self.cells { *m.entry(c.typ.clone()).or_default() += 1; }
        let mut v: Vec<_> = m.into_iter().collect();
        v.sort();
        v
    }
}
