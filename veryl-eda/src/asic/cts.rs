//! Clock tree synthesis (and the same buffer trees for asynchronous
//! set/reset nets), after placement: the sinks of each net are split
//! recursively at the median of their longer extent (an H-tree-like
//! balanced binary tree) until a group has at most MAX_LEAF sinks; every
//! tree node is a CLKBUF at the centroid of what it drives, legalized to the
//! nearest free sites. Balanced splits give every sink about the same number
//! of buffers and the same wire length, so the skew stays small.
//! Also: delay buffers in front of flip-flop inputs that violate hold.

use super::lib::{dims, ROW_H, SITE_W};
use super::place::{special_nets, RowPlacement};
use crate::netlist::{Bit, Cell, Netlist};

pub const MAX_LEAF: usize = 16;

pub struct Cts {
    /// per buffered net: (net, sinks, buffers, levels)
    pub trees: Vec<(Bit, usize, usize, u32)>,
    pub buffers: usize,
}

/// free-site map of a placement
struct Grid { occ: Vec<Vec<bool>>, rows: u32, sites: u32 }

impl Grid {
    fn of(nl: &Netlist, pl: &RowPlacement) -> Grid {
        let mut occ = vec![vec![false; pl.sites as usize]; pl.rows as usize];
        for (i, c) in nl.cells.iter().enumerate() {
            let (w, h) = dims(c);
            let (r, x) = pl.pos[i];
            for rr in r..(r + h).min(pl.rows) { for s in x..(x + w).min(pl.sites) { occ[rr as usize][s as usize] = true; } }
        }
        Grid { occ, rows: pl.rows, sites: pl.sites }
    }
    /// the free run of `w` sites nearest to (x µm, y µm); marks it used
    fn take(&mut self, x: f64, y: f64, w: u32) -> (u32, u32) {
        let (tr, tx) = (((y / ROW_H) as i64).clamp(0, self.rows as i64 - 1), ((x / SITE_W) as i64 - w as i64 / 2).clamp(0, (self.sites - w) as i64));
        let mut best: Option<(f64, u32, u32)> = None;
        for dr in 0..self.rows as i64 {
            // rows further away than the best found so far cannot win
            if let Some((d, _, _)) = best { if dr as f64 * ROW_H > d { break; } }
            for r in [tr - dr, tr + dr] {
                if r < 0 || r >= self.rows as i64 || (dr == 0 && r != tr) { continue; }
                let row = &self.occ[r as usize];
                for s in 0..=(self.sites - w) {
                    if (s..s + w).all(|t| !row[t as usize]) {
                        let d = dr as f64 * ROW_H + (s as i64 - tx).abs() as f64 * SITE_W;
                        if best.map(|b| d < b.0).unwrap_or(true) { best = Some((d, r as u32, s)); }
                    }
                }
            }
        }
        let (_, r, s) = best.expect("no free site left for a buffer");
        for t in s..s + w { self.occ[r as usize][t as usize] = true; }
        (r, s)
    }
}

fn next_wire(nl: &Netlist) -> u32 {
    nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()))
        .chain(nl.nets.iter().flat_map(|n| n.1.iter().copied()))
        .filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1
}

fn center(nl: &Netlist, pl: &RowPlacement, i: usize) -> (f64, f64) {
    let (w, h) = dims(&nl.cells[i]);
    let (r, x) = pl.pos[i];
    ((x as f64 + w as f64 / 2.0) * SITE_W, (r as f64 + h as f64 / 2.0) * ROW_H)
}

/// buffer trees for every clock / asynchronous set-reset net with more than MAX_LEAF sinks
pub fn build(nl: &mut Netlist, pl: &mut RowPlacement) -> Cts {
    let mut nets: Vec<Bit> = special_nets(nl).into_iter().collect();
    nets.sort();
    let mut grid = Grid::of(nl, pl);
    let mut wire = next_wire(nl);
    let bw = super::lib::cell("CLKBUF").width;
    let mut out = Cts { trees: vec![], buffers: 0 };
    for net in nets {
        // sinks: (cell, connection index, position)
        let mut sinks = vec![];
        for (i, c) in nl.cells.iter().enumerate() {
            for (k, (p, b)) in c.conns.iter().enumerate() {
                if *b == net && matches!(*p, "CK" | "RN" | "SN") { sinks.push((i, k, center(nl, pl, i))); }
            }
        }
        if sinks.len() <= MAX_LEAF { continue; }
        let n_sinks = sinks.len();
        let before = nl.cells.len();
        // (parent net, sinks, level), top-down
        let mut work = vec![(net, sinks, 1u32)];
        let mut levels = 0;
        while let Some((parent, group, level)) = work.pop() {
            levels = levels.max(level);
            let (cx, cy) = group.iter().fold((0.0, 0.0), |a, s| (a.0 + s.2 .0, a.1 + s.2 .1));
            let (cx, cy) = (cx / group.len() as f64, cy / group.len() as f64);
            let y = Bit::W(wire);
            wire += 1;
            nl.cells.push(Cell { typ: "CLKBUF".into(), conns: vec![("A", parent), ("Y", y)], params: vec![] });
            pl.pos.push(grid.take(cx, cy, bw));
            if group.len() <= MAX_LEAF {
                for (i, k, _) in group { nl.cells[i].conns[k].1 = y; }
                continue;
            }
            // split at the median of the longer extent
            let mut g = group;
            let (x0, x1) = g.iter().fold((f64::MAX, f64::MIN), |a, s| (a.0.min(s.2 .0), a.1.max(s.2 .0)));
            let (y0, y1) = g.iter().fold((f64::MAX, f64::MIN), |a, s| (a.0.min(s.2 .1), a.1.max(s.2 .1)));
            if x1 - x0 >= y1 - y0 { g.sort_by(|a, b| a.2 .0.partial_cmp(&b.2 .0).unwrap()); } else { g.sort_by(|a, b| a.2 .1.partial_cmp(&b.2 .1).unwrap()); }
            let right = g.split_off(g.len() / 2);
            work.push((y, right, level + 1));
            work.push((y, g, level + 1));
        }
        let nb = nl.cells.len() - before;
        out.buffers += nb;
        out.trees.push((net, n_sinks, nb, levels));
    }
    out
}

/// delay buffers in front of the flip-flop / macro inputs that violate hold:
/// (cell, pin, buffers to insert); returns how many were inserted
pub fn fix_hold(nl: &mut Netlist, pl: &mut RowPlacement, fixes: &[(usize, &'static str, usize)]) -> usize {
    let mut grid = Grid::of(nl, pl);
    let mut wire = next_wire(nl);
    let bw = super::lib::cell("BUF").width;
    let mut n = 0;
    for &(i, pin, count) in fixes {
        let (cx, cy) = center(nl, pl, i);
        let Some(k) = nl.cells[i].conns.iter().position(|(p, _)| *p == pin) else { continue };
        let mut prev = nl.cells[i].conns[k].1;
        for _ in 0..count {
            let y = Bit::W(wire);
            wire += 1;
            nl.cells.push(Cell { typ: "BUF".into(), conns: vec![("A", prev), ("Y", y)], params: vec![] });
            pl.pos.push(grid.take(cx, cy, bw));
            prev = y;
            n += 1;
        }
        nl.cells[i].conns[k].1 = prev;
    }
    n
}
