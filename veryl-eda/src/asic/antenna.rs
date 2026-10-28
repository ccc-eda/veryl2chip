//! Antenna rules (process antenna effect): while a metal layer is being
//! etched, the layers above it do not exist yet, so a wire that will later
//! reach its driver through a higher layer is, for a while, a piece of metal
//! hanging on transistor gates only. The charge it collects can damage the
//! gate oxide. The rules limit, for each piece of a layer at that moment,
//! the ratio of its side area (perimeter × thickness; cut layers: area) to
//! the gate area it reaches; the limit grows with the diffusion area the
//! piece reaches (a driver's output, a diode), from the technology LEF's
//! ANTENNADIFF(SIDE)AREARATIO tables. Gate and diffusion areas come from the
//! cells' LEF pins (ANTENNAGATEAREA, ANTENNADIFFAREA).
//!
//! The layout is built up layer by layer from the bottom (li1, mcon, met1,
//! via, met2, ...): metal joins what it touches on its layer, a cut joins the
//! metal below it when it is made and the metal above when that is. IO pins
//! count as neither gate nor diffusion.

use super::layout::{layer_index, Layout, Shape};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Violation {
    /// the net (the router's name) and a gate pin on the piece
    pub net: String,
    pub pin: String,
    /// the cell (index in the mapped netlist) and logical pin of that gate
    pub cell: usize,
    pub lpin: &'static str,
    pub layer: String,
    pub ratio: f64,
    pub limit: f64,
}

#[derive(Debug, Default)]
pub struct Antenna {
    /// pieces with gates checked (all layers), and the worst ratio / limit seen
    pub checked: usize,
    pub worst: f64,
    pub violations: Vec<Violation>,
}

fn find(p: &mut [usize], x: usize) -> usize {
    let mut x = x;
    while p[x] != x { p[x] = p[p[x]]; x = p[x]; }
    x
}
fn touch(a: &Shape, b: &Shape) -> bool { a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 }
fn overlap(a: &Shape, b: &Shape) -> bool { a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 }

pub fn check(l: &Layout, nl: &crate::netlist::Netlist) -> Antenna {
    let tech = crate::pdk::tech();
    let lef = tech.lef.as_ref().expect("antenna rules need a LEF technology");
    let nm = |x: f64| (x * 1000.0).round() as i64;
    // shapes: the routing (its own nets), then the cells' pin shapes; a pin's gate / diffusion area
    // goes with its first shape
    let mut shapes: Vec<Shape> = l.shapes.clone();
    let mut gate = vec![0.0; shapes.len()];
    let mut diff = vec![0.0; shapes.len()];
    let mut who: HashMap<usize, (String, usize, &'static str)> = HashMap::new();
    for (k, inst) in l.insts.iter().enumerate() {
        let Some(m) = lef.macro_(&inst.cell) else { continue };
        for p in m.pins.iter().filter(|p| !matches!(p.usage.as_str(), "POWER" | "GROUND")) {
            let mut first = true;
            for r in &p.shapes {
                let Some(li) = layer_index(&r.layer) else { continue };
                let (y0, y1) = if inst.flip { (inst.h - nm(r.y1), inst.h - nm(r.y0)) } else { (nm(r.y0), nm(r.y1)) };
                shapes.push(Shape { layer: li, x0: inst.x + nm(r.x0), y0: inst.y + y0, x1: inst.x + nm(r.x1), y1: inst.y + y1, net: usize::MAX });
                gate.push(if first { p.gate_area } else { 0.0 });
                diff.push(if first { p.diff_area } else { 0.0 });
                if first && p.gate_area > 0.0 && k < nl.cells.len() {
                    let c = &nl.cells[k];
                    let lp = tech.binding(&c.typ).and_then(|b| b.pins.iter().find(|x| x.1 == p.name).map(|x| x.0)).unwrap_or("?");
                    who.insert(shapes.len() - 1, (format!("{}/{}", inst.name, p.name), k, lp));
                }
                first = false;
            }
        }
    }
    let mut d = Antenna::default();
    // bins of 2 µm per layer
    const BIN: i64 = 2000;
    let mut bins: HashMap<(u8, i64, i64), Vec<usize>> = HashMap::new();
    for (i, s) in shapes.iter().enumerate() {
        for bx in s.x0.div_euclid(BIN)..=s.x1.div_euclid(BIN) { for by in s.y0.div_euclid(BIN)..=s.y1.div_euclid(BIN) { bins.entry((s.layer, bx, by)).or_default().push(i); } }
    }
    let near = |s: &Shape, ly: u8| -> Vec<usize> {
        let mut v = vec![];
        for bx in s.x0.div_euclid(BIN)..=s.x1.div_euclid(BIN) { for by in s.y0.div_euclid(BIN)..=s.y1.div_euclid(BIN) { if let Some(w) = bins.get(&(ly, bx, by)) { v.extend(w); } } }
        v.sort_unstable();
        v.dedup();
        v
    };
    let mut parent: Vec<usize> = (0..shapes.len()).collect();
    let mut per_layer: Vec<Vec<usize>> = vec![vec![]; l.layers.len()];
    for (i, s) in shapes.iter().enumerate() { if (s.layer as usize) < per_layer.len() { per_layer[s.layer as usize].push(i); } }
    for ly in 0..l.layers.len() as u8 {
        let cut = ly % 2 == 1;
        // build this layer: itself, and (a cut) the metal below / (a metal) the cuts below it
        for &i in &per_layer[ly as usize] {
            let s = shapes[i];
            let join = |j: usize, p: &mut Vec<usize>| { let (a, b) = (find(p, i), find(p, j)); if a != b { p[a] = b; } };
            for j in near(&s, ly) { if j != i && if cut { overlap(&s, &shapes[j]) } else { touch(&s, &shapes[j]) } { join(j, &mut parent); } }
            if ly > 0 { for j in near(&s, ly - 1) { if overlap(&s, &shapes[j]) { join(j, &mut parent); } } }
        }
        let Some(rule) = lef.layer(&l.layers[ly as usize]) else { continue };
        let table = if cut { &rule.antenna_area } else { &rule.antenna_side };
        if table.is_empty() { continue; }
        // per piece: this layer's (side) area, and the gates and diffusion it reaches so far
        let mut area: HashMap<usize, f64> = HashMap::new();
        for &i in &per_layer[ly as usize] {
            let s = &shapes[i];
            let (w, h) = ((s.x1 - s.x0) as f64 / 1000.0, (s.y1 - s.y0) as f64 / 1000.0);
            *area.entry(find(&mut parent, i)).or_default() += if cut { w * h } else { 2.0 * (w + h) * rule.thickness };
        }
        let mut g: HashMap<usize, (f64, f64, Option<usize>)> = HashMap::new();
        for i in 0..shapes.len() {
            if (gate[i] == 0.0 && diff[i] == 0.0) || shapes[i].layer > ly { continue; }
            let r = find(&mut parent, i);
            if !area.contains_key(&r) { continue; }
            let e = g.entry(r).or_insert((0.0, 0.0, None));
            e.0 += gate[i];
            e.1 += diff[i];
            if gate[i] > 0.0 && e.2.is_none() { e.2 = Some(i); }
        }
        for (r, (ga, da, first)) in g {
            if ga == 0.0 { continue; }
            d.checked += 1;
            let ratio = area[&r] / ga;
            let limit = crate::pdk::lef::Layer::pwl(table, da);
            d.worst = d.worst.max(ratio / limit);
            if ratio > limit {
                // the net: a routed shape on the piece carries the router's name
                let net = (0..l.shapes.len()).find(|&j| shapes[j].layer <= ly && find(&mut parent, j) == r).map(|j| l.nets.get(l.shapes[j].net).cloned().unwrap_or_default()).unwrap_or_default();
                let (pin, cell, lpin) = first.and_then(|f| who.get(&f).cloned()).unwrap_or(("?".into(), usize::MAX, "?"));
                d.violations.push(Violation { net, pin, cell, lpin, layer: l.layers[ly as usize].clone(), ratio, limit });
            }
        }
    }
    d
}
