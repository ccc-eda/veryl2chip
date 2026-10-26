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
//! A net still in conflict after a few iterations gets a wider corridor; at
//! the end, nets still in conflict are rerouted strictly around everything
//! else (whole die, occupied nodes forbidden), keeping the old route if that
//! fails.

use super::lib::{dims, row_h, site_w};
use super::place::{nets, RowPlacement};
use super::route::Routing;
use crate::netlist::{Bit, Netlist};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

pub const LAYERS: usize = 4;
/// tracks per row height (and per gcell side)
pub const TRACKS: u32 = 8;
const VIA_COST: f32 = 4.0;

/// the routing layer of grid layer `l` in the current technology
pub fn layer_name(l: u8) -> String { crate::pdk::tech().layers[l as usize].clone() }
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
    // library cells: their pin access points (rows alternate N / FS, so odd rows are mirrored)
    if let Some(&(_, dx, ty, _)) = crate::pdk::tech().binding(&c.typ).and_then(|b| b.access.iter().find(|a| a.0 == c.conns[k].0)) {
        return (s + dx, r * TRACKS + if r % 2 == 1 { TRACKS - 1 - ty } else { ty });
    }
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

/// x offset (µm) of the pin via of connection `k` of cell `i` from its grid node (0: on the node, NaN: no pin via)
pub fn pin_offset(nl: &Netlist, i: usize, k: usize) -> f64 {
    let c = &nl.cells[i];
    crate::pdk::tech().binding(&c.typ).and_then(|b| b.access.iter().find(|a| a.0 == c.conns[k].0)).map(|a| a.3).unwrap_or(0.0)
}

/// `pdn`: power straps and via stacks, off limits for signals
pub fn route(nl: &Netlist, pl: &RowPlacement, rt: &Routing, pdn: &super::pdn::Pdn) -> Detail {
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
    for (l, x, y) in pdn.blocked(ny) { if x < nx && y < ny { blocked[id(l, x, y) as usize] = true; } }
    // a library technology's rules (SKY130): met3 / met4 on every other track; no met1 on the two
    // tracks under the power rails; nothing beyond the core (the last column and track)
    let tech = crate::pdk::tech();
    let lib_rules = !tech.is_vlib();
    if lib_rules {
        for y in 0..ny {
            for x in 0..nx {
                if y % 2 == 1 { blocked[id(2, x, y) as usize] = true; }
                if x % 2 == 1 { blocked[id(3, x, y) as usize] = true; }
                if matches!(y % TRACKS, 0 | 7) { blocked[id(0, x, y) as usize] = true; }
                if x == nx - 1 || y == ny - 1 { for l in 0..LAYERS { blocked[id(l, x, y) as usize] = true; } }
            }
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
            let q = (LAYERS - 1, (pl.pins[k].x / site_w()).round().clamp(0.0, (nx - 1) as f64) as u32, (pl.pins[k].y / row_h() * TRACKS as f64).round().clamp(0.0, (ny - 1) as f64) as u32);
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
    // the cells' own met1 (flip-flop wiring, set / reset pins): off limits, except the pins' access nodes;
    // vias from met1 up only on (x + y) even nodes, and not next to another net's pin via
    let mut via_owner = vec![u32::MAX; plane];
    let mut no_via = vec![false; plane];
    let net_index: HashMap<Bit, u32> = terms.iter().enumerate().map(|(i, t)| (t.0, i as u32)).collect();
    if lib_rules {
        let lef = tech.lef.as_ref();
        let (sw, rh) = (site_w(), row_h());
        let tk = rh / TRACKS as f64;
        // a wire (half width 0.07) or a met1-met2 via pad (0.16 × 0.13) plus met1 spacing
        // (exactly the minimum spacing is legal)
        let keep = 0.07 + 0.14 - 1e-6;
        let (keep_vx, keep_vy) = (0.16 + 0.14 - 1e-6, 0.13 + 0.14 - 1e-6);
        for (i, c) in nl.cells.iter().enumerate() {
            let (Some(lef), Some(b)) = (lef, tech.binding(&c.typ)) else { continue };
            let Some(m) = lef.macro_(&b.cell) else { continue };
            let (r, s) = pl.pos[i];
            // obstructions (no owner) and the signal pins' met1 (their net's: other nets keep away)
            let mut rects: Vec<(&crate::pdk::lef::Rect, Option<u32>)> = m.obs.iter().filter(|q| q.layer == "met1").map(|q| (q, None)).collect();
            for p in m.pins.iter().filter(|p| p.usage != "POWER" && p.usage != "GROUND") {
                let owner = b.pins.iter().find(|x| x.1 == p.name).and_then(|x| c.port(x.0)).and_then(|bit| net_index.get(&bit).copied());
                rects.extend(p.shapes.iter().filter(|q| q.layer == "met1").map(|q| (q, owner)));
            }
            for (q, owner) in rects {
                let (y0, y1) = if r % 2 == 1 { (rh - q.y1, rh - q.y0) } else { (q.y0, q.y1) };
                let (ax0, ax1) = (s as f64 * sw + q.x0 - keep, s as f64 * sw + q.x1 + keep);
                let (ay0, ay1) = (r as f64 * rh + y0 - keep, r as f64 * rh + y1 + keep);
                let xs = (((ax0 - tech.track_x0) / sw).ceil().max(0.0) as u32)..=(((ax1 - tech.track_x0) / sw).floor().max(0.0) as u32);
                for x in xs {
                    for y in (((ay0 - tech.track_y0) / tk).ceil().max(0.0) as u32)..=(((ay1 - tech.track_y0) / tk).floor().max(0.0) as u32) {
                        if x >= nx || y >= ny { continue; }
                        let n = id(0, x, y) as usize;
                        match owner {
                            Some(o) if pin_owner[n] == u32::MAX || pin_owner[n] == o => pin_owner[n] = o,
                            _ => if pin_owner[n] == u32::MAX || owner.is_some() { blocked[n] = true; },
                        }
                    }
                }
                // no via pads there either (but the pin's own net may land on its met1)
                let (bx0, bx1) = (s as f64 * sw + q.x0 - keep_vx, s as f64 * sw + q.x1 + keep_vx);
                let (by0, by1) = (r as f64 * rh + y0 - keep_vy, r as f64 * rh + y1 + keep_vy);
                for x in (((bx0 - tech.track_x0) / sw).ceil().max(0.0) as u32)..=(((bx1 - tech.track_x0) / sw).floor().max(0.0) as u32) {
                    for y in (((by0 - tech.track_y0) / tk).ceil().max(0.0) as u32)..=(((by1 - tech.track_y0) / tk).floor().max(0.0) as u32) {
                        if x >= nx || y >= ny { continue; }
                        let k = (y * nx + x) as usize;
                        // the pin's own net may put a via pad on its met1 (touching it), not a little apart (a notch)
                        let (px, py) = (tech.track_x0 + x as f64 * sw, tech.track_y0 + y as f64 * tk);
                        let (sx0, sx1, sy0, sy1) = (s as f64 * sw + q.x0, s as f64 * sw + q.x1, r as f64 * rh + y0, r as f64 * rh + y1);
                        let gap = ((sx0 - px).max(px - sx1) - 0.16).max((sy0 - py).max(py - sy1) - 0.13);
                        match owner {
                            Some(o) if gap <= 0.0 && (via_owner[k] == u32::MAX || via_owner[k] == o) => via_owner[k] = o,
                            _ => no_via[k] = true,
                        }
                    }
                }
            }
        }
        for (ni, t) in terms.iter().enumerate() {
            for q in t.1.iter().filter(|q| q.0 == 0) {
                for (dx, dy) in [(0i64, -1i64), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)] {
                    let (xx, yy) = (q.1 as i64 + dx, q.2 as i64 + dy);
                    if xx < 0 || yy < 0 || xx >= nx as i64 || yy >= ny as i64 { continue; }
                    let k = (yy as u32 * nx + xx as u32) as usize;
                    // right above / below: no via of any net (not even the pin's own: their pads would leave a notch)
                    if dx == 0 { no_via[k] = true; continue; }
                    via_owner[k] = if via_owner[k] == u32::MAX || via_owner[k] == ni as u32 { ni as u32 } else { u32::MAX - 1 };
                }
            }
        }
        // an IO pin's shape reaches 0.8 µm into the die: the top-layer nodes whose wire would come
        // closer to it than the spacing are the pin's net's
        let (sw, tk) = (site_w(), row_h() / TRACKS as f64);
        let nm = |v: f64| (v * 1000.0).round() as i64;
        for (ni, t) in terms.iter().enumerate() {
            for q in t.1.iter().filter(|q| q.0 == LAYERS - 1) {
                let (px, py) = (nm(q.1 as f64 * sw + tech.track_x0), nm(q.2 as f64 * tk + tech.track_y0));
                let (x0, y0, x1, y1) = super::layout::pin_rect(px, py, nm(pl.w), nm(pl.h));
                for x in q.1.saturating_sub(4)..(q.1 + 5).min(nx) {
                    for y in q.2.saturating_sub(4)..(q.2 + 5).min(ny) {
                        let (cx, cy) = (nm(x as f64 * sw + tech.track_x0), nm(y as f64 * tk + tech.track_y0));
                        let gap = (x0 - (cx + 150)).max((cx - 150) - x1).max(y0 - (cy + 150)).max((cy - 150) - y1);
                        let n = id(LAYERS - 1, x, y) as usize;
                        if gap < 300 && pin_owner[n] == u32::MAX { pin_owner[n] = ni as u32; }
                    }
                }
            }
        }
        // a pin via off its node towards a neighbour: that neighbour is the pin's too
        for (c, cell) in nl.cells.iter().enumerate() {
            for k in 0..cell.conns.len() {
                let off = pin_offset(nl, c, k);
                if off.is_nan() || off.abs() < 0.015 { continue; }
                let (x, y) = pin_point(nl, pl, c, k);
                let xx = if off > 0.0 { x + 1 } else { x.wrapping_sub(1) };
                if xx >= nx { continue; }
                let o = pin_owner[id(0, x, y) as usize];
                let n = id(0, xx, y) as usize;
                // (another pin's own node stays that pin's)
                if pin_owner[n] == u32::MAX { pin_owner[n] = o; } else if pin_owner[n] != o { continue; }
                // no via there either, nor diagonally on that side: its pad would come too close to the contact's
                no_via[(y * nx + xx) as usize] = true;
                for yy in [y.wrapping_sub(1), y + 1] { if yy < ny { no_via[(yy * nx + xx) as usize] = true; } }
            }
        }
    }
    // along-track neighbours that another net may not use (met2 / met3 / met4 line ends and via pads)
    let halo = |n: u32| -> [u32; 2] {
        let (l, x, y) = decode(n);
        if !lib_rules || l <= 1 { return [u32::MAX; 2]; }
        if horizontal(l) { [if x > 0 { id(l, x - 1, y) } else { u32::MAX }, if x + 1 < nx { id(l, x + 1, y) } else { u32::MAX }] }
        else { [if y > 0 { id(l, x, y - 1) } else { u32::MAX }, if y + 1 < ny { id(l, x, y + 1) } else { u32::MAX }] }
    };
    let mut near = vec![0u16; if lib_rules { total } else { 0 }];
    // after each round: which net sits on each node, and which nets clash with another's halo
    let mut owner = vec![u32::MAX; if lib_rules { total } else { 0 }];
    let mut clash = vec![false; terms.len()];
    // met2 nodes beside a via that lands on met2 (its pad reaches them): (node below of the via) -> the two met2 neighbours
    let pad_halo = |v: u32| -> [u32; 2] {
        let (l, x, y) = decode(v);
        if !lib_rules || l > 1 { return [u32::MAX; 2]; }
        [if y > 0 { id(1, x, y - 1) } else { u32::MAX }, if y + 1 < ny { id(1, x, y + 1) } else { u32::MAX }]
    };
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
    // the vias each net's paths actually take: (the node below)
    let mut pvias: Vec<Vec<u32>> = vec![vec![]; terms.len()];
    let mut iters = vec![];
    let mut pres = 0.5f32;
    let mut order: Vec<usize> = (0..terms.len()).collect();
    order.sort_by_key(|i| terms[*i].1.len());
    let mut opens = vec![0usize; terms.len()];
    const NEGOTIATE: usize = 60;
    for it in 0..NEGOTIATE + 3 {
        // the last rounds: strict rip-up and reroute of what is still in conflict
        let hard = it >= NEGOTIATE;
        for &ni in &order {
            if terms[ni].1.len() < 2 { continue; }
            let conflicted = paths[ni].iter().any(|&n| occ[n as usize] > 1) || clash[ni];
            if it > 0 && !conflicted && opens[ni] == 0 { continue; }
            // still stuck after a few rounds: give it more room
            if !hard && ((it >= 4 && it % 4 == 0) || (it >= 16 && it % 2 == 0)) { widen(&mut terms[ni].2); }
            let (_, t, gc) = &terms[ni];
            let cmark = (it * terms.len() + ni) as u32;
            if hard { gc_mark.iter_mut().for_each(|g| *g = cmark); } else { for g in gc { gc_mark[*g as usize] = cmark; } }
            let old = std::mem::take(&mut paths[ni]);
            for &n in &old { occ[n as usize] -= 1; if lib_rules { for h in halo(n) { if h != u32::MAX { near[h as usize] -= 1; } } } }
            if lib_rules { for &v in &pvias[ni] { for h in pad_halo(v) { if h != u32::MAX { near[h as usize] -= 1; } } } }
            let old_opens = opens[ni];
            opens[ni] = 0;
            let mark = (it * terms.len() + ni) as u32;
            let mut vias_now: Vec<u32> = vec![];
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
                        let (vl, vx, vy) = decode(v);
                        // met1-met2 vias: checkerboard nodes, and not beside another net's pin via
                        if lib_rules && vl != l && vl.min(l) == 0 {
                            // (a pin's own node may always go up: no other net's via can be beside it)
                            if (vx + vy) % 2 == 1 && pin_owner[id(0, vx, vy) as usize] != ni as u32 { continue; }
                            let o = via_owner[(vy * nx + vx) as usize];
                            if o != u32::MAX && o != ni as u32 && pin_owner[id(0, vx, vy) as usize] != ni as u32 { continue; }
                            if no_via[(vy * nx + vx) as usize] { continue; }
                        }
                        let mut nv = if lib_rules { near[v as usize] } else { 0 };
                        // a via landing on met2: other nets on the met2 nodes beside it
                        if lib_rules && vl != l && vl.min(l) <= 1 {
                            for h in pad_halo(if l < vl { u } else { v }) { if h != u32::MAX { nv += occ[h as usize]; } }
                        }
                        if gc_mark[((vy / TRACKS) * gx + vx / TRACKS) as usize] != cmark { continue; }
                        // another net's pin access point is off limits
                        let o = pin_owner[v as usize];
                        if o != u32::MAX && o != ni as u32 { continue; }
                        if hard && (occ[v as usize] > 0 || nv > 0) { continue; }
                        let c = step * (1.0 + hist[v as usize]) * (1.0 + pres * (occ[v as usize] + nv) as f32);
                        let nd = du + c;
                        if seen[v as usize] != gen || nd < dist[v as usize] {
                            seen[v as usize] = gen;
                            dist[v as usize] = nd;
                            prev[v as usize] = u;
                            heap.push(Item(nd + hd(v), v));
                        }
                    }
                }
                if goal == u32::MAX { opens[ni] += 1; if hard && std::env::var("DBG_OPEN").is_ok() {
                    let (_, x, y) = (t[j].0, t[j].1, t[j].2);
                    let k = (y * nx + x) as usize;
                    let nb: Vec<String> = [(x.wrapping_sub(1), y), (x + 1, y)].iter().filter(|q| q.0 < nx).map(|&(a, b)| { let v = id(0, a, b) as usize; format!("({},{}) blk {} own {} nv {} vo {}", a, b, blocked[v], pin_owner[v] as i64, no_via[(b * nx + a) as usize], via_owner[(b * nx + a) as usize] as i64) }).collect();
                    eprintln!("open: net {} terminal {:?} parity {} no_via {} via_owner {} up-blocked {} | {:?}", ni, t[j], (x + y) % 2, no_via[k], via_owner[k] as i64, blocked[id(1, x, y) as usize], nb);
                } continue; }
                // walk back from where the tree was reached to the terminal
                let mut v = goal;
                while v != u32::MAX && v != src {
                    let p = prev[v as usize];
                    if p != u32::MAX && decode(p).0 != decode(v).0 { vias_now.push(p.min(v)); }
                    if in_tree[p as usize] != mark { in_tree[p as usize] = mark; nodes.push(p); }
                    v = p;
                }
                in_tree[src as usize] = mark;
                if !nodes.contains(&src) { nodes.push(src); }
            }
            // a strict reroute that cannot connect everything keeps the old route
            let nodes = if hard && opens[ni] > 0 { opens[ni] = old_opens; old } else { pvias[ni] = vias_now; nodes };
            for &n in &nodes { occ[n as usize] += 1; if lib_rules { for h in halo(n) { if h != u32::MAX { near[h as usize] += 1; } } } }
            if lib_rules { for &v in &pvias[ni] { for h in pad_halo(v) { if h != u32::MAX { near[h as usize] += 1; } } } }
            paths[ni] = nodes;
        }
        let mut conflicts = occ.iter().filter(|o| **o > 1).count();
        if lib_rules {
            // another net on a node a path's halo or via pads reach
            for o in owner.iter_mut() { *o = u32::MAX; }
            for (ni, p) in paths.iter().enumerate() { for &n in p { owner[n as usize] = if owner[n as usize] == u32::MAX { ni as u32 } else { u32::MAX - 1 }; } }
            for c in clash.iter_mut() { *c = false; }
            for (ni, (p, pv)) in paths.iter().zip(&pvias).enumerate() {
                let other = |h: u32| h != u32::MAX && owner[h as usize] != u32::MAX && owner[h as usize] != ni as u32;
                let mut k = 0;
                for &n in p { for h in halo(n) { if other(h) { k += 1; } } }
                for &v in pv { for h in pad_halo(v) { if other(h) { k += 1; } } }
                if k > 0 { clash[ni] = true; conflicts += k; }
            }
            for (n, o) in near.iter().enumerate() { if *o > 0 && occ[n] > 0 { hist[n] += 0.1; } }
        }
        iters.push(conflicts);
        if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("  detail iteration {}: {} conflicts, {} opens", it + 1, conflicts, opens.iter().sum::<usize>()); }
        if conflicts == 0 && opens.iter().all(|o| *o == 0) { break; }
        for (n, o) in occ.iter().enumerate() { if *o > 1 { hist[n] += 0.4 * (*o - 1) as f32; } }
        if hard { continue; }
        // capped: beyond this the costs stop being comparable in f32
        pres = (pres * 1.7).min(1000.0);
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
        }
        let mut pv = pvias[ni].clone();
        pv.sort();
        pv.dedup();
        for n in pv { let (l, x, y) = decode(n); vias.push((l as u8, x, y)); }
        for q in t { if q.0 == 0 { vias.push((255, q.1, q.2)); } }
        let len: f64 = segs.iter().map(|s| (s.3 - s.1 + s.4 - s.2) as f64 * site_w()).sum();
        for s in &segs { per_layer[s.0 as usize] += (s.3 - s.1 + s.4 - s.2) as f64 * site_w(); }
        wl += len;
        nv += vias.len();
        out.push(DNet { bit: *bit, segs, vias, length: len });
    }
    let conflicts = *iters.last().unwrap_or(&0);
    Detail { nx, ny, nets: out, wirelength: wl, vias: nv, conflicts, opens: opens.iter().sum(), iters, per_layer }
}
