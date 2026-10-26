//! Design rule check of a library layout (SKY130): the routed shapes
//! (`layout::build`) together with the cells' own pin and obstruction shapes
//! from the LEF. Rules from the technology LEF:
//! - short: two nets' shapes overlap on a layer
//! - spacing: two nets' shapes on a routing layer closer than its SPACING
//!   (notches inside one net's merged metal: `tools/gds_check.py`, KLayout)
//!   (cut layers: any two different cuts closer than the cut spacing)
//! - area: a via landing pad on a routing layer that no wire of its net
//!   extends, smaller than the layer's minimum AREA
//! - open: a net whose shapes (with the cells' pins) are not one piece
//! Wide-metal spacing tables, end-of-line and antenna rules are not checked.

use super::layout::{layer_index, Layout, Shape};
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct Drc {
    pub shorts: usize,
    pub spacing: usize,
    pub area: usize,
    pub opens: usize,
    /// a few examples: (rule, layer, x, y) in nm
    pub examples: Vec<(String, String, i64, i64)>,
    pub shapes: usize,
    /// the same examples with both shapes and their nets
    pub details: Vec<String>,
}

impl Drc {
    pub fn total(&self) -> usize { self.shorts + self.spacing + self.area + self.opens }
}

/// the cells' pin (with their net) and obstruction (a net of their own) shapes
fn cell_shapes(l: &Layout, nl: &crate::netlist::Netlist, nets: &mut Vec<String>, net_of: &HashMap<crate::netlist::Bit, usize>) -> Vec<Shape> {
    let tech = crate::pdk::tech();
    let Some(lef) = tech.lef.as_ref() else { return vec![] };
    let nm = |x: f64| (x * 1000.0).round() as i64;
    let mut out = vec![];
    // the logic cells come first in the instance list, in netlist order
    for (k, inst) in l.insts.iter().enumerate() {
        let Some(m) = lef.macro_(&inst.cell) else { continue };
        let place = |r: &crate::pdk::lef::Rect| -> (i64, i64, i64, i64) {
            let (y0, y1) = if inst.flip { (inst.h - nm(r.y1), inst.h - nm(r.y0)) } else { (nm(r.y0), nm(r.y1)) };
            (inst.x + nm(r.x0), inst.y + y0, inst.x + nm(r.x1), inst.y + y1)
        };
        let own = nets.len();
        nets.push(format!("{}/obs", inst.name));
        for r in &m.obs {
            let Some(li) = layer_index(&r.layer) else { continue };
            let (x0, y0, x1, y1) = place(r);
            out.push(Shape { layer: li, x0, y0, x1, y1, net: own });
        }
        for p in &m.pins {
            let net = match p.usage.as_str() {
                "POWER" => 0,
                "GROUND" => 1,
                _ => {
                    // the logical pin's net (cells only; fillers and taps have no signal pins)
                    let c = nl.cells.get(k).filter(|_| k < nl.cells.len());
                    let b = c.and_then(|c| tech.binding(&c.typ).and_then(|b| b.pins.iter().find(|x| x.1 == p.name).map(|x| x.0)).and_then(|lp| c.port(lp)));
                    match b.and_then(|b| net_of.get(&b)) { Some(n) => *n, None => { nets.push(format!("{}/{}", inst.name, p.name)); nets.len() - 1 } }
                }
            };
            for r in &p.shapes {
                let Some(li) = layer_index(&r.layer) else { continue };
                let (x0, y0, x1, y1) = place(r);
                out.push(Shape { layer: li, x0, y0, x1, y1, net });
            }
        }
    }
    out
}

fn gap(a: &Shape, b: &Shape) -> i64 {
    let dx = (b.x0 - a.x1).max(a.x0 - b.x1).max(0);
    let dy = (b.y0 - a.y1).max(a.y0 - b.y1).max(0);
    // Euclidean for corners, as the rules measure
    if dx > 0 && dy > 0 { ((dx * dx + dy * dy) as f64).sqrt() as i64 } else { dx.max(dy) }
}

fn overlap(a: &Shape, b: &Shape) -> bool { a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 }
fn touch(a: &Shape, b: &Shape) -> bool { a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 }

pub fn check(l: &Layout, nl: &crate::netlist::Netlist) -> Drc {
    let net_of = &l.net_of;
    let tech = crate::pdk::tech();
    let lef = tech.lef.as_ref().expect("DRC needs a LEF technology");
    let mut nets = l.nets.clone();
    let mut shapes = l.shapes.clone();
    let routed = shapes.len();
    shapes.extend(cell_shapes(l, nl, &mut nets, net_of));
    let mut d = Drc { shapes: shapes.len(), ..Default::default() };
    // (spacing in nm, cut layer?)
    let rule = |li: u8| -> (i64, bool) {
        let ly = lef.layer(&l.layers[li as usize]);
        (ly.map(|x| (x.spacing * 1000.0).round() as i64).unwrap_or(0), ly.map(|x| x.kind == "CUT").unwrap_or(false))
    };
    let min_area: HashMap<u8, f64> = [("met1", 0.083), ("met2", 0.0676), ("met3", 0.24), ("met4", 0.24), ("li1", 0.0561)].iter()
        .filter_map(|(n, a)| layer_index(n).map(|i| (i, *a))).collect();
    // bins of 2 µm per layer
    const BIN: i64 = 2000;
    let mut bins: HashMap<(u8, i64, i64), Vec<usize>> = HashMap::new();
    for (i, s) in shapes.iter().enumerate() {
        for bx in s.x0.div_euclid(BIN)..=s.x1.div_euclid(BIN) { for by in s.y0.div_euclid(BIN)..=s.y1.div_euclid(BIN) { bins.entry((s.layer, bx, by)).or_default().push(i); } }
    }
    let mut seen: std::collections::HashSet<(usize, usize)> = Default::default();
    let detail = |d: &mut Drc, what: &str, a: &Shape, b: &Shape, nets: &Vec<String>| {
        if d.details.len() < 12 {
            let f = |s: &Shape| format!("{} [{:.3} {:.3} {:.3} {:.3}]", nets.get(s.net).map(|x| x.as_str()).unwrap_or("?"), s.x0 as f64 / 1e3, s.y0 as f64 / 1e3, s.x1 as f64 / 1e3, s.y1 as f64 / 1e3);
            d.details.push(format!("{} on {}: {} / {}", what, l.layers[a.layer as usize], f(a), f(b)));
        }
    };
    let example = |d: &mut Drc, what: &str, s: &Shape| { if d.examples.len() < 12 { d.examples.push((what.into(), l.layers[s.layer as usize].clone(), s.x0, s.y0)); } };
    for ((li, bx, by), v) in &bins {
        let (sp, cut) = rule(*li);
        if sp == 0 { continue; }
        // shapes in this bin against those in this and the neighbouring bins
        let mut near: Vec<usize> = vec![];
        for dx in -1..=1 { for dy in -1..=1 { if let Some(w) = bins.get(&(*li, bx + dx, by + dy)) { near.extend(w); } } }
        for &a in v {
            for &b in &near {
                if a >= b || (a >= routed && b >= routed) { continue; }
                if !seen.insert((a, b)) { continue; }
                let (sa, sb) = (&shapes[a], &shapes[b]);
                let same = sa.net == sb.net;
                if cut {
                    // cuts: distinct cuts of any nets keep their spacing (one cut drawn twice is fine)
                    if sa == sb || (sa.x0, sa.y0, sa.x1, sa.y1) == (sb.x0, sb.y0, sb.x1, sb.y1) { continue; }
                    if overlap(sa, sb) && !same { d.shorts += 1; example(&mut d, "short", sa); detail(&mut d, "short", sa, sb, &nets); }
                    else if !overlap(sa, sb) && gap(sa, sb) < sp { d.spacing += 1; example(&mut d, "spacing", sa); detail(&mut d, "spacing", sa, sb, &nets); }
                    continue;
                }
                // one net: pieces that do not touch still keep the spacing (a notch when they are joined elsewhere)
                if same { continue; }
                if overlap(sa, sb) { d.shorts += 1; example(&mut d, "short", sa); detail(&mut d, "short", sa, sb, &nets); }
                else if gap(sa, sb) < sp { d.spacing += 1; example(&mut d, "spacing", sa); detail(&mut d, "spacing", sa, sb, &nets); }
            }
        }
    }
    // landing pads no wire of their net extends: their own area must meet the minimum
    for (i, s) in shapes.iter().enumerate().take(routed) {
        let Some(&min) = min_area.get(&s.layer) else { continue };
        let a = (s.x1 - s.x0) as f64 * (s.y1 - s.y0) as f64 * 1e-6;
        if a >= min { continue; }
        let mut total = a;
        let mut grown = false;
        for bx in s.x0.div_euclid(BIN) - 1..=s.x1.div_euclid(BIN) + 1 {
            for by in s.y0.div_euclid(BIN) - 1..=s.y1.div_euclid(BIN) + 1 {
                for &j in bins.get(&(s.layer, bx, by)).map(|v| v.as_slice()).unwrap_or(&[]) {
                    let t = &shapes[j];
                    if j == i || t.net != s.net || !touch(s, t) { continue; }
                    if (t.x0, t.y0, t.x1, t.y1) == (s.x0, s.y0, s.x1, s.y1) { continue; }
                    // another piece of the same net: the union is larger
                    total += (t.x1 - t.x0) as f64 * (t.y1 - t.y0) as f64 * 1e-6;
                    grown = true;
                }
            }
        }
        if !grown && total < min { d.area += 1; example(&mut d, "area", s); }
    }
    // connectivity: per net, its routed shapes and its cells' pin shapes as one piece
    let mut by_net: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, s) in shapes.iter().enumerate() { if s.net >= 2 && s.net < l.nets.len() { by_net.entry(s.net).or_default().push(i); } }
    let cut_pair = |li: u8| -> Option<(u8, u8)> { if li >= 1 && li % 2 == 1 { Some((li - 1, li + 1)) } else { None } };
    for (_, v) in by_net {
        if v.len() < 2 { continue; }
        // union-find over touching shapes on a layer, and cuts joining the layers below / above
        let mut parent: Vec<usize> = (0..v.len()).collect();
        fn find(p: &mut Vec<usize>, x: usize) -> usize { let mut x = x; while p[x] != x { p[x] = p[p[x]]; x = p[x]; } x }
        for a in 0..v.len() {
            for b in a + 1..v.len() {
                let (sa, sb) = (&shapes[v[a]], &shapes[v[b]]);
                let join = if sa.layer == sb.layer { touch(sa, sb) } else {
                    let (c, m) = if cut_pair(sa.layer).is_some() { (sa, sb) } else { (sb, sa) };
                    cut_pair(c.layer).map(|(lo, hi)| (m.layer == lo || m.layer == hi) && overlap(c, m)).unwrap_or(false)
                };
                if join { let (ra, rb) = (find(&mut parent, a), find(&mut parent, b)); if ra != rb { parent[ra] = rb; } }
            }
            if v.len() > 4000 { break; }
        }
        let roots: std::collections::HashSet<usize> = (0..v.len()).map(|x| find(&mut parent, x)).collect();
        if roots.len() > 1 { d.opens += 1; example(&mut d, "open", &shapes[v[0]]); }
    }
    d
}
