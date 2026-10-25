//! Global routing on a grid of gcells (one row high and as wide): horizontal
//! wires on M2/M4, vertical wires on M3/M5, each gcell edge holding a fixed
//! number of tracks per direction. A net's terminals are joined in Prim
//! (minimum spanning tree) order; each one is connected to the tree built so
//! far by A* from the terminal, with PathFinder negotiation (present +
//! history cost) on overflowing edges. Vias are counted where a route turns
//! and where it reaches a pin (M1).

use super::lib::{ROW_H, SITE_W};
use super::place::{nets, special_nets, RowPlacement};
use crate::netlist::{Bit, Netlist};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

/// tracks per gcell edge and direction: two layers × 10 tracks (4 µm gcell,
/// 0.4 µm pitch), 20 % kept for local wiring
pub const CAP: u16 = 16;

pub struct NetRoute {
    pub bit: Bit,
    /// gcell segments (x0, y0, x1, y1); horizontal = M2, vertical = M3
    pub segs: Vec<(u32, u32, u32, u32)>,
    pub length: f64,
    pub vias: u32,
    pub clock: bool,
}

pub struct Routing {
    pub gx: u32,
    pub gy: u32,
    pub nets: Vec<NetRoute>,
    pub iters: Vec<u32>,
    pub wirelength: f64,
    pub vias: u32,
    pub overflow: u32,
}

#[derive(PartialEq)]
struct Item(f32, u32);
impl Eq for Item {}
impl Ord for Item { fn cmp(&self, o: &Self) -> Ordering { o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal) } }
impl PartialOrd for Item { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

pub fn route(nl: &Netlist, pl: &RowPlacement) -> Routing {
    let g = ROW_H;
    let gx = ((pl.w / g).ceil() as u32).max(1);
    let gy = pl.rows.max(1);
    let id = |x: u32, y: u32| y * gx + x;
    let dims: Vec<(u32, u32)> = nl.cells.iter().map(super::lib::dims).collect();
    let gcell_of_cell = |c: usize| {
        let (r, s) = pl.pos[c];
        let (w, h) = dims[c];
        ((((s as f64 + w as f64 / 2.0) * SITE_W) / g).floor().min(gx as f64 - 1.0) as u32, (r + h / 2).min(gy - 1))
    };
    let gcell_of_pin = |k: usize| {
        let p = &pl.pins[k];
        ((p.x / g).floor().clamp(0.0, gx as f64 - 1.0) as u32, (p.y / g).floor().clamp(0.0, gy as f64 - 1.0) as u32)
    };
    let special = special_nets(nl);
    let pn = nets(nl, &pl.pins);
    // terminals of each net (distinct gcells), and how many cell pins (for M1 vias)
    let mut terms: Vec<(Bit, Vec<u32>, u32)> = vec![];
    for p in &pn {
        let mut t: Vec<u32> = vec![];
        for &c in &p.cells { let (x, y) = gcell_of_cell(c); let i = id(x, y); if !t.contains(&i) { t.push(i); } }
        for &k in &p.pins { let (x, y) = gcell_of_pin(k); let i = id(x, y); if !t.contains(&i) { t.push(i); } }
        terms.push((p.bit, t, (p.cells.len() + p.pins.len()) as u32));
    }
    // edges: horizontal edge h(x,y) between (x,y)-(x+1,y); vertical v(x,y) between (x,y)-(x,y+1)
    let ne = (gx * gy) as usize;
    let mut use_h = vec![0u16; ne];
    let mut use_v = vec![0u16; ne];
    let mut hist_h = vec![0f32; ne];
    let mut hist_v = vec![0f32; ne];
    let mut trees: Vec<Vec<(u32, u32)>> = vec![vec![]; terms.len()]; // edges as (from, to) node ids
    let mut iters = vec![];
    let mut pres = 0.5f32;
    let mut dist = vec![f32::INFINITY; ne];
    let mut prev = vec![u32::MAX; ne];
    let mut seen = vec![0u32; ne];
    let mut gen = 0u32;
    let edge = |a: u32, b: u32| -> (bool, usize) {
        let (lo, hi) = (a.min(b), a.max(b));
        if hi - lo == 1 && hi % gx != 0 { (true, lo as usize) } else { (false, lo as usize) }
    };
    // Prim order of each net's terminals: (terminal, its tree parent)
    let md = |a: u32, b: u32| (a % gx).abs_diff(b % gx) + (a / gx).abs_diff(b / gx);
    let prim: Vec<Vec<(u32, u32)>> = terms.iter().map(|(_, t, _)| {
        let k = t.len();
        let mut out = vec![];
        if k < 2 { return out; }
        let mut done = vec![false; k];
        let mut best: Vec<(u32, usize)> = (0..k).map(|i| (md(t[0], t[i]), 0)).collect();
        done[0] = true;
        for _ in 1..k {
            let (j, _) = (0..k).filter(|&i| !done[i]).map(|i| (i, best[i].0)).min_by_key(|x| x.1).unwrap();
            done[j] = true;
            out.push((t[j], t[best[j].1]));
            for i in 0..k { if !done[i] { let d = md(t[j], t[i]); if d < best[i].0 { best[i] = (d, j); } } }
        }
        out
    }).collect();
    let mut in_tree = vec![u32::MAX; ne];
    let mut order: Vec<usize> = (0..terms.len()).collect();
    order.sort_by_key(|i| terms[*i].1.len());
    for it in 0..30 {
        for &ni in &order {
            let t = &terms[ni].1;
            if t.len() < 2 { continue; }
            if it > 0 {
                let over = trees[ni].iter().any(|&(a, b)| { let (h, e) = edge(a, b); if h { use_h[e] > CAP } else { use_v[e] > CAP } });
                if !over { continue; }
            }
            for &(a, b) in &trees[ni] { let (h, e) = edge(a, b); if h { use_h[e] -= 1 } else { use_v[e] -= 1 } }
            trees[ni].clear();
            // a fresh stamp per (iteration, net) marks tree membership
            let mark = (it * terms.len() + ni) as u32;
            in_tree[t[0] as usize] = mark;
            for &(src, parent) in &prim[ni] {
                if in_tree[src as usize] == mark { continue; }
                gen += 1;
                let (px, py) = (parent % gx, parent / gx);
                let hd = |v: u32| ((v % gx).abs_diff(px) + (v / gx).abs_diff(py)) as f32;
                let mut heap = BinaryHeap::new();
                dist[src as usize] = 0.0; prev[src as usize] = u32::MAX; seen[src as usize] = gen;
                heap.push(Item(hd(src), src));
                let mut goal = u32::MAX;
                while let Some(Item(_, u)) = heap.pop() {
                    if in_tree[u as usize] == mark { goal = u; break; }
                    let (ux, uy) = (u % gx, u / gx);
                    let du = dist[u as usize];
                    let mut nb = [u32::MAX; 4];
                    if ux > 0 { nb[0] = u - 1; }
                    if ux + 1 < gx { nb[1] = u + 1; }
                    if uy > 0 { nb[2] = u - gx; }
                    if uy + 1 < gy { nb[3] = u + gx; }
                    for v in nb {
                        if v == u32::MAX { continue; }
                        let (h, e) = edge(u, v);
                        let (us, hi) = if h { (use_h[e], hist_h[e]) } else { (use_v[e], hist_v[e]) };
                        let over = (us + 1).saturating_sub(CAP) as f32;
                        let nd = du + (1.0 + hi) * (1.0 + pres * over);
                        if seen[v as usize] != gen || nd < dist[v as usize] {
                            seen[v as usize] = gen;
                            dist[v as usize] = nd;
                            prev[v as usize] = u;
                            heap.push(Item(nd + hd(v), v));
                        }
                    }
                }
                // walk from where the tree was reached back to the terminal
                let mut v = goal;
                while v != u32::MAX && v != src {
                    let p = prev[v as usize];
                    trees[ni].push((p, v));
                    in_tree[p as usize] = mark;
                    v = p;
                }
                in_tree[src as usize] = mark;
            }
            for &(a, b) in &trees[ni] { let (h, e) = edge(a, b); if h { use_h[e] += 1 } else { use_v[e] += 1 } }
        }
        let mut over = 0u32;
        for e in 0..ne {
            if use_h[e] > CAP { over += (use_h[e] - CAP) as u32; hist_h[e] += 0.5; }
            if use_v[e] > CAP { over += (use_v[e] - CAP) as u32; hist_v[e] += 0.5; }
        }
        iters.push(over);
        if over == 0 { break; }
        pres *= 1.6;
    }
    // segments, length, vias
    let mut out = vec![];
    let (mut wl, mut vias) = (0.0, 0u32);
    for (ni, (bit, _, npins)) in terms.iter().enumerate() {
        let mut segs = vec![];
        let mut dirs: HashMap<u32, (bool, bool)> = HashMap::new(); // node -> (has horizontal, has vertical)
        for &(a, b) in &trees[ni] {
            let (h, _) = edge(a, b);
            segs.push((a % gx, a / gx, b % gx, b / gx));
            for v in [a, b] { let d = dirs.entry(v).or_default(); if h { d.0 = true } else { d.1 = true } }
        }
        let turns = dirs.values().filter(|d| d.0 && d.1).count() as u32;
        let v = turns + npins;
        let len = trees[ni].len() as f64 * g;
        wl += len;
        vias += v;
        out.push(NetRoute { bit: *bit, segs, length: len, vias: v, clock: special.contains(bit) });
    }
    let overflow = *iters.last().unwrap_or(&0);
    Routing { gx, gy, nets: out, iters, wirelength: wl, vias, overflow }
}
