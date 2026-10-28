//! Parasitic extraction from the detailed routing (a library technology):
//! every routed net becomes an RC tree, so the final timing uses the wires
//! that were really drawn instead of an estimate from distances.
//!
//! The pieces of a net (straight wires on the track grid, vias between
//! layers, the pin via down to each cell pin) are cut where other pieces
//! join them; a wire piece has R = length × R/□ / width and C = length ×
//! (area C × width + 2 × edge C) from the technology LEF, a via its cut
//! resistance. From the driver (the cell output, or the input pin) the delay
//! to each sink is the Elmore delay: Σ along the path of R × the capacitance
//! downstream of it, the sinks' pin capacitances included.

use super::detail::{pin_point, Detail, TRACKS};
use super::lib::{dims, row_h, site_w};
use super::place::RowPlacement;
use crate::netlist::{is_out, Bit, Dir, Netlist};
use std::collections::{BTreeMap, HashMap};

/// a point a sink is timed at: a cell's centre or an IO pin, in nm (the keys STA uses)
pub fn key(x: f64, y: f64) -> (i64, i64) { ((x * 1000.0).round() as i64, (y * 1000.0).round() as i64) }

#[derive(Default)]
pub struct Extraction {
    /// wire capacitance of each net (pF)
    pub cap: HashMap<Bit, f64>,
    /// Elmore delay (ns) from the net's driver to a sink (by the sink's point, see `key`)
    pub delay: HashMap<(Bit, (i64, i64)), f64>,
    /// nets extracted, and the largest wire delay found
    pub nets: usize,
    pub worst: f64,
}

/// a node of a net's tree: (layer, x, y) on the track grid; layer 254 = a cell pin
type Node = (u8, u32, u32);

pub fn extract(nl: &Netlist, pl: &RowPlacement, d: &Detail) -> Extraction {
    let tech = crate::pdk::tech();
    let Some(lef) = tech.lef.as_ref() else { return Extraction::default() };
    let tk = row_h() / TRACKS as f64;
    // per routing layer: Ω and pF per µm; per via layer (between i and i + 1): Ω per cut
    let layer = |i: usize| lef.layer(&tech.layers[i]);
    let r_um: Vec<f64> = (0..4).map(|i| layer(i).map(|l| l.rpersq / l.width.max(1e-3)).unwrap_or(0.0)).collect();
    let c_um: Vec<f64> = (0..4).map(|i| layer(i).map(|l| l.cpersq * l.width + 2.0 * l.edgecap).unwrap_or(0.0)).collect();
    let cut_r = |name: &str| lef.via(name).and_then(|v| v.rects.iter().find_map(|r| lef.layer(&r.layer).filter(|l| l.kind == "CUT").map(|l| l.cut_r))).unwrap_or(0.0);
    let via_r: Vec<f64> = tech.vias.iter().map(|v| cut_r(v)).collect();
    let pin_via_r = cut_r(&tech.pin_via);
    // each net's pins on the grid: (node, cell, pin index); the driver is the cell output or the input port
    let mut pins: HashMap<Bit, Vec<((u32, u32), Option<(usize, usize)>)>> = HashMap::new();
    for (i, c) in nl.cells.iter().enumerate() {
        for (k, (_, b)) in c.conns.iter().enumerate() {
            if b.is_const() { continue; }
            pins.entry(*b).or_default().push((pin_point(nl, pl, i, k), Some((i, k))));
        }
    }
    let top = 3u8;
    for p in &pl.pins {
        let node = (((p.x / site_w()).round() as u32).min(d.nx.saturating_sub(1)), ((p.y / tk).round() as u32).min(d.ny.saturating_sub(1)));
        pins.entry(p.bit).or_default().push((node, None));
    }
    let port_dir: HashMap<Bit, Dir> = nl.ports.iter().flat_map(|p| p.bits.iter().map(move |b| (*b, p.dir))).collect();
    let center = |i: usize| { let (r, x) = pl.pos[i]; let (w, h) = dims(&nl.cells[i]); ((x as f64 + w as f64 / 2.0) * site_w(), (r as f64 + h as f64 / 2.0) * row_h()) };
    let mut out = Extraction::default();
    for n in &d.nets {
        let Some(ps) = pins.get(&n.bit) else { continue };
        // the points of each layer where pieces meet: segment ends, vias, pin vias
        let mut points: HashMap<u8, Vec<(u32, u32)>> = HashMap::new();
        for &(l, x0, y0, x1, y1) in &n.segs { points.entry(l).or_default().extend([(x0, y0), (x1, y1)]); }
        for &(l, x, y) in &n.vias {
            if l == 255 { points.entry(0).or_default().push((x, y)); } else { points.entry(l).or_default().push((x, y)); points.entry(l + 1).or_default().push((x, y)); }
        }
        // the IO pin sits on the top layer at its node
        for (node, who) in ps { if who.is_none() { points.entry(top).or_default().push(*node); } }
        for v in points.values_mut() { v.sort_unstable(); v.dedup(); }
        // edges: (a, b, R Ω, C pF)
        let mut adj: HashMap<Node, Vec<(Node, f64)>> = HashMap::new();
        let mut node_c: HashMap<Node, f64> = HashMap::new();
        let mut add = |a: Node, b: Node, r: f64, c: f64| {
            adj.entry(a).or_default().push((b, r));
            adj.entry(b).or_default().push((a, r));
            *node_c.entry(a).or_default() += c / 2.0;
            *node_c.entry(b).or_default() += c / 2.0;
        };
        let mut wire_c = 0.0;
        for &(l, x0, y0, x1, y1) in &n.segs {
            let (lx, hx, ly, hy) = (x0.min(x1), x0.max(x1), y0.min(y1), y0.max(y1));
            // the points on this piece, in order along it
            let mut on: Vec<(u32, u32)> = points.get(&l).map(|v| v.iter().copied().filter(|&(x, y)| x >= lx && x <= hx && y >= ly && y <= hy).collect()).unwrap_or_default();
            on.sort_unstable();
            for w in on.windows(2) {
                let len = (w[1].0 - w[0].0) as f64 * site_w() + (w[1].1 - w[0].1) as f64 * tk;
                let c = len * c_um[l as usize];
                wire_c += c;
                add((l, w[0].0, w[0].1), (l, w[1].0, w[1].1), len * r_um[l as usize], c);
            }
        }
        for &(l, x, y) in &n.vias {
            if l == 255 { add((254, x, y), (0, x, y), pin_via_r, 0.0); } else { add((l, x, y), (l + 1, x, y), via_r.get(l as usize).copied().unwrap_or(0.0), 0.0); }
        }
        // the sinks' pin capacitances; the driver
        let mut driver: Option<Node> = None;
        let mut sinks: Vec<(Node, (i64, i64))> = vec![];
        for (node, who) in ps {
            match who {
                Some((i, k)) => {
                    let (p, _) = &nl.cells[*i].conns[*k];
                    let at = (254, node.0, node.1);
                    if is_out(p) { driver = Some(at); continue; }
                    *node_c.entry(at).or_default() += tech.pin_cap(&nl.cells[*i].typ, p);
                    let (cx, cy) = center(*i);
                    sinks.push((at, key(cx, cy)));
                }
                None => {
                    let at = (top, node.0, node.1);
                    if port_dir.get(&n.bit) == Some(&Dir::In) { driver = Some(at); continue; }
                    *node_c.entry(at).or_default() += 0.002;
                    let p = pl.pins.iter().find(|p| p.bit == n.bit).unwrap();
                    sinks.push((at, key(p.x, p.y)));
                }
            }
        }
        out.cap.insert(n.bit, wire_c);
        let Some(root) = driver.filter(|r| adj.contains_key(r)) else { continue };
        // a tree from the driver (breadth first), the capacitance downstream of each node, then Elmore
        let mut parent: BTreeMap<Node, (Node, f64)> = BTreeMap::new();
        let mut order = vec![root];
        let mut seen: std::collections::HashSet<Node> = [root].into();
        let mut i = 0;
        while i < order.len() {
            let a = order[i];
            i += 1;
            for &(b, r) in adj.get(&a).map(|v| v.as_slice()).unwrap_or(&[]) {
                if seen.insert(b) { parent.insert(b, (a, r)); order.push(b); }
            }
        }
        let mut down: HashMap<Node, f64> = order.iter().map(|x| (*x, node_c.get(x).copied().unwrap_or(0.0))).collect();
        for &x in order.iter().rev() {
            if let Some(&(p, _)) = parent.get(&x) { let c = down[&x]; *down.get_mut(&p).unwrap() += c; }
        }
        let mut delay: HashMap<Node, f64> = HashMap::new();
        delay.insert(root, 0.0);
        for &x in &order[1..] {
            let (p, r) = parent[&x];
            // Ω × pF = ps
            delay.insert(x, delay[&p] + r * down[&x] * 1e-3);
        }
        for (at, k) in sinks {
            if let Some(t) = delay.get(&at) {
                out.worst = out.worst.max(*t);
                out.delay.insert((n.bit, k), *t);
            }
        }
        out.nets += 1;
    }
    out
}
