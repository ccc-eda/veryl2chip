//! Detailed routing on a track grid: tracks every 0.5 µm in both directions
//! (8 per row height, so a 4 µm gcell holds 8 × 8 track crossings), four
//! routing layers M2 (horizontal), M3 (vertical), M4 (horizontal), M5
//! (vertical). Every grid node carries at most one net, so a legal result
//! has no shorts by construction. Each net is routed inside the corridor
//! its global route chose (its gcells plus one around them): terminals in
//! Prim order, A* from the new terminal to the tree built so far, a via
//! costs as much as a few tracks; overlaps are negotiated away (PathFinder)
//! over several iterations. Cell pins are reached from M1 through a via at
//! a fixed access point inside the cell (macro pins along its top edge);
//! SRAM macros block M2/M3 above them; IO pins are on M5 at the die edge.
//! A net still in conflict after a few iterations gets a wider corridor.

use super::lib::{dims, ROW_H, SITE_W};
use super::place::{nets, RowPlacement};
use super::route::Routing;
use crate::netlist::{Bit, Netlist};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

pub const LAYERS: usize = 4;
/// tracks per row height (and per gcell side)
pub const TRACKS: u32 = 8;
const VIA_COST: f32 = 4.0;

pub fn layer_name(l: u8) -> &'static str { ["M2", "M3", "M4", "M5"][l as usize] }
fn horizontal(l: usize) -> bool { l % 2 == 0 }

pub struct DNet {
    pub bit: Bit,
    /// straight wire pieces: (layer, x0, y0, x1, y1) in track units
    pub segs: Vec<(u8, u32, u32, u32, u32)>,
    /// vias: (lower layer, x, y); layer 255 = the M1 pin via
    pub vias: Vec<(u8, u32, u32)>,
    pub length: f64,
}

pub struct Detail {
    pub nx: u32,
    pub ny: u32,
    pub nets: Vec<DNet>,
    pub wirelength: f64,
    pub vias: usize,
    /// grid nodes still used by more than one net (0 = legal)
    pub conflicts: usize,
    /// terminals that could not be connected (0 = complete)
    pub opens: usize,
    /// conflicts after each iteration
    pub iters: Vec<usize>,
    /// wire length per layer (µm)
    pub per_layer: [f64; LAYERS],
}

#[derive(PartialEq)]
struct Item(f32, u32);
impl Eq for Item {}
impl Ord for Item { fn cmp(&self, o: &Self) -> Ordering { o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal) } }
impl PartialOrd for Item { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

/// pin access point (x, y in track units) of connection `k` of cell `i`
pub fn pin_point(nl: &Netlist, pl: &RowPlacement, i: usize, k: usize) -> (u32, u32) {
    let c = &nl.cells[i];
    let (w, h) = dims(c);
    let (r, s) = pl.pos[i];
    let n = c.conns.len().max(1);
    if h > 1 {
        // macro: pins spread along its top edge, just inside
        let x = s + ((k as u32 * 2 + 1) * w) / (n as u32 * 2);
        return (x.min(s + w - 1), (r + h) * TRACKS - 1);
    }
    // standard cell: pins left to right, at alternating heights
    let x = s + ((k as u32) * w) / n as u32;
    let y = r * TRACKS + 2 + (k as u32 % 2) * 3;
    (x.min(s + w - 1), y)
}

pub fn route(nl: &Netlist, pl: &RowPlacement, rt: &Routing) -> Detail {
    let nx = pl.sites + 1;
    let ny = pl.rows * TRACKS + 1;
    let plane = (nx * ny) as usize;
    let total = plane * LAYERS;
    let id = |l: usize, x: u32, y: u32| (l * plane) as u32 + y * nx + x;
    let decode = |n: u32| { let l = n as usize / plane; let r = n as usize % plane; (l, r as u32 % nx, r as u32 / nx) };
    // blockages: M2/M3 over macros
    let mut blocked = vec![false; total];
    for (i, c) in nl.cells.iter().enumerate() {
        let (w, h) = dims(c);
        if h <= 1 { continue; }
        let (r, s) = pl.pos[i];
        for y in r * TRACKS..(r + h) * TRACKS - 1 {
            for x in s..s + w { for l in 0..2 { blocked[id(l, x, y) as usize] = true; } }
        }
    }
    // terminals of each net
    let pn = nets(nl, &pl.pins);
    let corridor_of: HashMap<Bit, &Vec<(u32, u32, u32, u32)>> = rt.nets.iter().map(|n| (n.bit, &n.segs)).collect();
    // terminals: (layer, x, y)
    let mut terms: Vec<(Bit, Vec<(usize, u32, u32)>, HashSet<u32>)> = vec![];
    let mut pin_owner = vec![u32::MAX; total];
    for p in &pn {
        let mut t: Vec<(usize, u32, u32)> = vec![];
        for &c in &p.cells {
            for (k, (_, b)) in nl.cells[c].conns.iter().enumerate() {
                if *b == p.bit { let q = pin_point(nl, pl, c, k); if !t.contains(&(0, q.0, q.1)) { t.push((0, q.0, q.1)); } }
            }
        }
        for &k in &p.pins {
            let q = (LAYERS - 1, (pl.pins[k].x / SITE_W).round().clamp(0.0, (nx - 1) as f64) as u32, (pl.pins[k].y / ROW_H * TRACKS as f64).round().clamp(0.0, (ny - 1) as f64) as u32);
            if !t.contains(&q) { t.push(q); }
        }
        // the corridor: gcells of the global route and of the terminals, one gcell around
        let mut gc: HashSet<u32> = HashSet::new();
        let (gx, gy) = (nx.div_ceil(TRACKS), ny.div_ceil(TRACKS));
        let mut add = |x: i64, y: i64| {
            for dx in -1..=1 { for dy in -1..=1 {
                let (a, b) = (x + dx, y + dy);
                if a >= 0 && b >= 0 && (a as u32) < gx && (b as u32) < gy { gc.insert(b as u32 * gx + a as u32); }
            } }
        };
        if let Some(segs) = corridor_of.get(&p.bit) { for s in segs.iter() { add(s.0 as i64, s.1 as i64); add(s.2 as i64, s.3 as i64); } }
        for q in &t { add((q.1 / TRACKS) as i64, (q.2 / TRACKS) as i64); }
        let ni = terms.len();
        for q in &t { pin_owner[id(q.0, q.1, q.2) as usize] = ni as u32; }
        terms.push((p.bit, t, gc));
    }
    let gx = nx.div_ceil(TRACKS);
    let gy = ny.div_ceil(TRACKS);
    // the current net's corridor, stamped per gcell
    let mut gc_mark = vec![u32::MAX; (gx * gy) as usize];
    let widen = |gc: &mut HashSet<u32>| {
        let old: Vec<u32> = gc.iter().copied().collect();
        for g in old {
            let (x, y) = ((g % gx) as i64, (g / gx) as i64);
            for dx in -1..=1 { for dy in -1..=1 {
                let (a, b) = (x + dx, y + dy);
                if a >= 0 && b >= 0 && (a as u32) < gx && (b as u32) < gy { gc.insert(b as u32 * gx + a as u32); }
            } }
        }
    };

    let mut occ = vec![0u16; total];
    let mut hist = vec![0f32; total];
    let mut dist = vec![f32::INFINITY; total];
    let mut prev = vec![u32::MAX; total];
    let mut seen = vec![0u32; total];
    let mut gen = 0u32;
    let mut in_tree = vec![u32::MAX; total];
    let mut paths: Vec<Vec<u32>> = vec![vec![]; terms.len()];
    let mut iters = vec![];
    let mut pres = 0.5f32;
    let mut order: Vec<usize> = (0..terms.len()).collect();
    order.sort_by_key(|i| terms[*i].1.len());
    let mut opens = vec![0usize; terms.len()];
    for it in 0..40 {
        for &ni in &order {
            if terms[ni].1.len() < 2 { continue; }
            let conflicted = paths[ni].iter().any(|&n| occ[n as usize] > 1);
            if it > 0 && !conflicted && opens[ni] == 0 { continue; }
            // still stuck after a few rounds: give it more room
            if it >= 4 && it % 4 == 0 { widen(&mut terms[ni].2); }
            let (_, t, gc) = &terms[ni];
            let cmark = (it * terms.len() + ni) as u32;
            for g in gc { gc_mark[*g as usize] = cmark; }
            for &n in &paths[ni] { occ[n as usize] -= 1; }
            paths[ni].clear();
            opens[ni] = 0;
            let mark = (it * terms.len() + ni) as u32;
            // Prim order of the terminals
            let md = |a: (usize, u32, u32), b: (usize, u32, u32)| a.1.abs_diff(b.1) + a.2.abs_diff(b.2);
            let mut done = vec![false; t.len()];
            let mut best: Vec<(u32, usize)> = t.iter().map(|q| (md(t[0], *q), 0)).collect();
            done[0] = true;
            let root = id(t[0].0, t[0].1, t[0].2);
            in_tree[root as usize] = mark;
            let mut nodes: Vec<u32> = vec![root];
            for _ in 1..t.len() {
                let j = (0..t.len()).filter(|&i| !done[i]).min_by_key(|&i| best[i].0).unwrap();
                done[j] = true;
                for i in 0..t.len() { if !done[i] { let d = md(t[j], t[i]); if d < best[i].0 { best[i] = (d, j); } } }
                let src = id(t[j].0, t[j].1, t[j].2);
                if in_tree[src as usize] == mark { continue; }
                let goal_xy = t[best[j].1];
                // weighted A* (×1.5): a little longer paths, far fewer nodes visited
                let hd = |n: u32| { let (_, x, y) = decode(n); 1.5 * (x.abs_diff(goal_xy.1) + y.abs_diff(goal_xy.2)) as f32 };
                gen += 1;
                let mut heap = BinaryHeap::new();
                dist[src as usize] = 0.0;
                prev[src as usize] = u32::MAX;
                seen[src as usize] = gen;
                heap.push(Item(hd(src), src));
                let mut goal = u32::MAX;
                while let Some(Item(_, u)) = heap.pop() {
                    if in_tree[u as usize] == mark { goal = u; break; }
                    let (l, x, y) = decode(u);
                    let du = dist[u as usize];
                    let mut nb: [(u32, f32); 4] = [(u32::MAX, 0.0); 4];
                    if horizontal(l) {
                        if x > 0 { nb[0] = (id(l, x - 1, y), 1.0); }
                        if x + 1 < nx { nb[1] = (id(l, x + 1, y), 1.0); }
                    } else {
                        if y > 0 { nb[0] = (id(l, x, y - 1), 1.0); }
                        if y + 1 < ny { nb[1] = (id(l, x, y + 1), 1.0); }
                    }
                    if l > 0 { nb[2] = (id(l - 1, x, y), VIA_COST); }
                    if l + 1 < LAYERS { nb[3] = (id(l + 1, x, y), VIA_COST); }
                    for (v, step) in nb {
                        if v == u32::MAX || blocked[v as usize] { continue; }
                        let (_, vx, vy) = decode(v);
                        if gc_mark[((vy / TRACKS) * gx + vx / TRACKS) as usize] != cmark { continue; }
                        // another net's pin access point is off limits
                        let o = pin_owner[v as usize];
                        if o != u32::MAX && o != ni as u32 { continue; }
                        let c = step * (1.0 + hist[v as usize]) * (1.0 + pres * occ[v as usize] as f32);
                        let nd = du + c;
                        if seen[v as usize] != gen || nd < dist[v as usize] {
                            seen[v as usize] = gen;
                            dist[v as usize] = nd;
                            prev[v as usize] = u;
                            heap.push(Item(nd + hd(v), v));
                        }
                    }
                }
                if goal == u32::MAX { opens[ni] += 1; continue; }
                // walk back from where the tree was reached to the terminal
                let mut v = goal;
                while v != u32::MAX && v != src {
                    let p = prev[v as usize];
                    if in_tree[p as usize] != mark { in_tree[p as usize] = mark; nodes.push(p); }
                    v = p;
                }
                in_tree[src as usize] = mark;
                if !nodes.contains(&src) { nodes.push(src); }
            }
            for &n in &nodes { occ[n as usize] += 1; }
            paths[ni] = nodes;
        }
        let conflicts = occ.iter().filter(|o| **o > 1).count();
        iters.push(conflicts);
        if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("  detail iteration {}: {} conflicts, {} opens", it + 1, conflicts, opens.iter().sum::<usize>()); }
        if conflicts == 0 && opens.iter().all(|o| *o == 0) { break; }
        for (n, o) in occ.iter().enumerate() { if *o > 1 { hist[n] += 0.4 * (*o - 1) as f32; } }
        pres *= 1.7;
    }
    // node sets -> wire pieces and vias
    let mut out = vec![];
    let (mut wl, mut nv) = (0.0, 0usize);
    let mut per_layer = [0.0; LAYERS];
    for (ni, (bit, t, _)) in terms.iter().enumerate() {
        let set: HashSet<u32> = paths[ni].iter().copied().collect();
        let mut segs = vec![];
        let mut vias = vec![];
        for &n in &paths[ni] {
            let (l, x, y) = decode(n);
            // a piece starts where its track neighbour before it is not in the net
            let (px, py) = if horizontal(l) { (x.wrapping_sub(1), y) } else { (x, y.wrapping_sub(1)) };
            let before = px < nx && py < ny && set.contains(&id(l, px, py));
            if !before {
                let (mut ex, mut ey) = (x, y);
                loop {
                    let (qx, qy) = if horizontal(l) { (ex + 1, ey) } else { (ex, ey + 1) };
                    if qx < nx && qy < ny && set.contains(&id(l, qx, qy)) { ex = qx; ey = qy; } else { break; }
                }
                if (ex, ey) != (x, y) { segs.push((l as u8, x, y, ex, ey)); }
            }
            if l + 1 < LAYERS && set.contains(&id(l + 1, x, y)) { vias.push((l as u8, x, y)); }
        }
        for q in t { if q.0 == 0 { vias.push((255, q.1, q.2)); } }
        let len: f64 = segs.iter().map(|s| (s.3 - s.1 + s.4 - s.2) as f64 * SITE_W).sum();
        for s in &segs { per_layer[s.0 as usize] += (s.3 - s.1 + s.4 - s.2) as f64 * SITE_W; }
        wl += len;
        nv += vias.len();
        out.push(DNet { bit: *bit, segs, vias, length: len });
    }
    let conflicts = *iters.last().unwrap_or(&0);
    Detail { nx, ny, nets: out, wirelength: wl, vias: nv, conflicts, opens: opens.iter().sum(), iters, per_layer }
}
