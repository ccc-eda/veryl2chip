//! Layout versus schematic: the layout's connectivity, extracted from its
//! geometry alone, against the mapped netlist. The router's net labels on
//! the shapes are not used (checking them would only check the router
//! against itself): every routed shape, via cut and the cells' pin shapes
//! from the LEF are conductors; shapes on one layer that touch are one
//! piece, a cut joins the metal below and above it that it overlaps. Each
//! piece then holds terminals: cell pins (their logical net from the
//! netlist, VDD / VSS for power pins), IO pins (found at their labels).
//! - open: a net whose terminals are in more than one piece
//! - short: a piece holding terminals of more than one net
//! - devices: the layout's cell instances against the netlist's cells
//!
//! The cells' obstructions (their internal wiring) are not conductors here:
//! a route touching them is a DRC short. Floating pieces (routing with no
//! terminal) are counted, not errors.

use super::layout::{layer_index, Layout, Shape};
use super::Output;
use crate::netlist::Bit;
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Default)]
pub struct Lvs {
    /// nets with two or more terminals, and all terminals
    pub nets: usize,
    pub terminals: usize,
    pub opens: usize,
    pub shorts: usize,
    /// layout instances that are not the netlist's cell (name, cell) at that place
    pub device_errors: usize,
    pub devices: usize,
    /// pieces of routing that reach no terminal
    pub floating: usize,
    /// conductor shapes and the pieces they form
    pub shapes: usize,
    pub pieces: usize,
    pub details: Vec<String>,
}

impl Lvs {
    pub fn errors(&self) -> usize { self.opens + self.shorts + self.device_errors }
}

/// what a terminal should be connected to
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Want { Vdd, Vss, Net(Bit), None }

fn find(p: &mut [usize], x: usize) -> usize {
    let mut x = x;
    while p[x] != x { p[x] = p[p[x]]; x = p[x]; }
    x
}

fn touch(a: &Shape, b: &Shape) -> bool { a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 }
fn overlap(a: &Shape, b: &Shape) -> bool { a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 }

pub fn check(l: &Layout, o: &Output) -> Lvs {
    let tech = crate::pdk::tech();
    let lef = tech.lef.as_ref().expect("LVS needs a LEF technology");
    let nl = &o.mapped;
    let nm = |x: f64| (x * 1000.0).round() as i64;
    let mut d = Lvs::default();
    // conductors: the routed shapes (net labels dropped), then the cells' pin shapes with their terminal
    let mut shapes: Vec<Shape> = l.shapes.iter().map(|s| Shape { net: usize::MAX, ..*s }).collect();
    let routed = shapes.len();
    // terminals: (name, what it should reach); term_shape: the shape each one starts from
    let mut terms: Vec<(String, Want)> = vec![];
    let mut term_shape: Vec<usize> = vec![];
    // ---- devices: the logic cells come first in the instance list, in netlist order ----
    for (k, c) in nl.cells.iter().enumerate() {
        d.devices += 1;
        let want = tech.cell_name(&c.typ);
        match l.insts.get(k) {
            Some(inst) if inst.name == format!("c{}", k) && inst.cell == want => {}
            other => {
                d.device_errors += 1;
                if d.details.len() < 12 { d.details.push(format!("device c{}: netlist {} ({}), layout {:?}", k, want, c.typ, other.map(|i| (&i.name, &i.cell)))); }
            }
        }
    }
    for (k, inst) in l.insts.iter().enumerate() {
        let Some(m) = lef.macro_(&inst.cell) else { continue };
        let cell = if k < nl.cells.len() { Some(&nl.cells[k]) } else { None };
        for p in &m.pins {
            let want = match p.usage.as_str() {
                "POWER" => Want::Vdd,
                "GROUND" => Want::Vss,
                _ => cell
                    .and_then(|c| tech.binding(&c.typ).and_then(|b| b.pins.iter().find(|x| x.1 == p.name).map(|x| x.0)).and_then(|lp| c.port(lp)))
                    .map(Want::Net)
                    .unwrap_or(Want::None),
            };
            let t = terms.len();
            let mut first = None;
            for r in &p.shapes {
                let Some(li) = layer_index(&r.layer) else { continue };
                let (y0, y1) = if inst.flip { (inst.h - nm(r.y1), inst.h - nm(r.y0)) } else { (nm(r.y0), nm(r.y1)) };
                first.get_or_insert(shapes.len());
                shapes.push(Shape { layer: li, x0: inst.x + nm(r.x0), y0: inst.y + y0, x1: inst.x + nm(r.x1), y1: inst.y + y1, net: t });
            }
            // a pin with no shape on a conducting layer (a well tie) is no terminal
            if let Some(f) = first { terms.push((format!("{}/{}", inst.name, p.name), want)); term_shape.push(f); }
        }
    }
    d.shapes = shapes.len();
    // ---- connectivity: union-find over touching shapes (bins of 2 µm per layer) ----
    const BIN: i64 = 2000;
    let mut bins: HashMap<(u8, i64, i64), Vec<usize>> = HashMap::new();
    for (i, s) in shapes.iter().enumerate() {
        for bx in s.x0.div_euclid(BIN)..=s.x1.div_euclid(BIN) { for by in s.y0.div_euclid(BIN)..=s.y1.div_euclid(BIN) { bins.entry((s.layer, bx, by)).or_default().push(i); } }
    }
    let mut parent: Vec<usize> = (0..shapes.len()).collect();
    let cut = |li: u8| -> bool { li % 2 == 1 };
    for (i, s) in shapes.iter().enumerate() {
        // the same layer (metal: touching; a cut drawn twice: overlapping); a cut also the metal below and above
        let mut layers = vec![(s.layer, cut(s.layer))];
        if cut(s.layer) { layers.push((s.layer - 1, true)); if (s.layer as usize + 1) < l.layers.len() { layers.push((s.layer + 1, true)); } }
        for (ly, strict) in layers {
            let mut seen = BTreeSet::new();
            for bx in s.x0.div_euclid(BIN)..=s.x1.div_euclid(BIN) {
                for by in s.y0.div_euclid(BIN)..=s.y1.div_euclid(BIN) {
                    for &j in bins.get(&(ly, bx, by)).map(|v| v.as_slice()).unwrap_or(&[]) {
                        if j == i || !seen.insert(j) { continue; }
                        let t = &shapes[j];
                        if if strict { overlap(s, t) } else { touch(s, t) } {
                            let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                            if a != b { parent[a] = b; }
                        }
                    }
                }
            }
        }
    }
    // ---- IO pins: the top-layer shape under each label ----
    let port_bit: HashMap<&str, Bit> = o.placement.pins.iter().map(|p| (p.name.as_str(), p.bit)).collect();
    for (ly, x, y, name) in &l.labels {
        let want = match name.as_str() {
            "VPWR" => Want::Vdd,
            "VGND" => Want::Vss,
            n => port_bit.get(n).map(|b| Want::Net(*b)).unwrap_or(Want::None),
        };
        let under = bins.get(&(*ly, x.div_euclid(BIN), y.div_euclid(BIN))).and_then(|v| v.iter().copied().find(|&j| {
            let s = &shapes[j];
            s.x0 <= *x && *x <= s.x1 && s.y0 <= *y && *y <= s.y1
        }));
        match under {
            Some(j) => { terms.push((format!("port {}", name), want)); term_shape.push(j); }
            None => { d.opens += 1; if d.details.len() < 12 { d.details.push(format!("port {}: no metal under its label", name)); } }
        }
    }
    d.terminals = terms.len();
    // ---- compare: pieces per net (opens), nets per piece (shorts) ----
    let mut pieces_of: HashMap<Want, BTreeSet<usize>> = HashMap::new();
    let mut nets_in: HashMap<usize, BTreeSet<Want>> = HashMap::new();
    let mut names_in: HashMap<usize, Vec<usize>> = HashMap::new();
    for (t, (_, want)) in terms.iter().enumerate() {
        let r = find(&mut parent, term_shape[t]);
        names_in.entry(r).or_default().push(t);
        if *want == Want::None { continue; }
        pieces_of.entry(*want).or_default().insert(r);
        nets_in.entry(r).or_default().insert(*want);
    }
    let count = |w: &Want| terms.iter().filter(|t| t.1 == *w).count();
    let name = |w: &Want| match w { Want::Vdd => "VDD".to_string(), Want::Vss => "VSS".to_string(), Want::Net(Bit::W(n)) => format!("n{}", n), _ => "?".into() };
    let mut wants: Vec<&Want> = pieces_of.keys().collect();
    wants.sort();
    for w in wants {
        if count(w) < 2 { continue; }
        d.nets += 1;
        let ps = &pieces_of[w];
        if ps.len() > 1 {
            d.opens += 1;
            if d.details.len() < 12 {
                let parts: Vec<String> = ps.iter().take(3).map(|r| names_in[r].iter().filter(|&&t| terms[t].1 == *w).take(3).map(|&t| terms[t].0.clone()).collect::<Vec<_>>().join(" ")).collect();
                d.details.push(format!("open {}: {} pieces ({})", name(w), ps.len(), parts.join(" | ")));
            }
        }
    }
    let mut roots: Vec<&usize> = nets_in.keys().collect();
    roots.sort();
    for r in roots {
        let ws = &nets_in[r];
        if ws.len() > 1 {
            d.shorts += 1;
            if d.details.len() < 12 {
                let ex: Vec<String> = ws.iter().take(4).map(|w| format!("{} ({})", name(w), names_in[r].iter().find(|&&t| terms[t].1 == *w).map(|&t| terms[t].0.as_str()).unwrap_or(""))).collect();
                d.details.push(format!("short: {}", ex.join(" + ")));
            }
        }
    }
    // pieces, and routed pieces that reach no terminal
    let all: BTreeSet<usize> = (0..shapes.len()).map(|i| find(&mut parent, i)).collect();
    d.pieces = all.len();
    let with_term: BTreeSet<usize> = names_in.keys().copied().collect();
    let routed_roots: BTreeSet<usize> = (0..routed).map(|i| find(&mut parent, i)).collect();
    d.floating = routed_roots.difference(&with_term).count();
    d
}
