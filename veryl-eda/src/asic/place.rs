//! Row placement: standard cells in rows of sites, simulated annealing on
//! half-perimeter wirelength. Every move keeps the placement legal (a cell
//! moves into a free run of sites, or two cells swap places).

use super::lib::{cell, ROW_H, SITE_W};
use crate::netlist::{Bit, Dir, Netlist};
use crate::pnr::place::Rng;
use std::collections::HashMap;

pub struct Frame {
    pub temp: f64,
    pub cost: f64,
    pub accept: f64,
    /// cell -> (row, site)
    pub pos: Vec<(u32, u32)>,
}

pub struct Pin {
    pub name: String,
    pub dir: Dir,
    pub x: f64,
    pub y: f64,
    pub bit: Bit,
}

pub struct RowPlacement {
    pub rows: u32,
    pub sites: u32,
    /// die size in µm
    pub w: f64,
    pub h: f64,
    pub pos: Vec<(u32, u32)>,
    pub pins: Vec<Pin>,
    pub history: Vec<Frame>,
    pub util: f64,
}

/// a net for wirelength: cells and pins it connects
pub struct PNet { pub cells: Vec<usize>, pub pins: Vec<usize>, pub bit: Bit }

pub fn nets(nl: &Netlist, pins: &[Pin]) -> Vec<PNet> {
    let mut m: HashMap<Bit, PNet> = HashMap::new();
    let mut order: Vec<Bit> = vec![];
    for (i, c) in nl.cells.iter().enumerate() {
        for (_, b) in &c.conns {
            if b.is_const() { continue; }
            let e = m.entry(*b).or_insert_with(|| { order.push(*b); PNet { cells: vec![], pins: vec![], bit: *b } });
            if !e.cells.contains(&i) { e.cells.push(i); }
        }
    }
    for (k, p) in pins.iter().enumerate() {
        if let Some(e) = m.get_mut(&p.bit) { e.pins.push(k); }
    }
    order.into_iter().map(|b| m.remove(&b).unwrap()).filter(|n| n.cells.len() + n.pins.len() > 1).collect()
}

/// wires that drive clock / asynchronous set-reset pins (built as trees, not placed by wirelength)
pub fn special_nets(nl: &Netlist) -> std::collections::HashSet<Bit> {
    nl.cells.iter().filter(|c| c.is_ff()).flat_map(|c| c.conns.iter().filter(|(p, _)| matches!(*p, "CK" | "RN" | "SN")).map(|x| x.1)).collect()
}

pub fn place(nl: &Netlist, seed: u64) -> RowPlacement {
    let n = nl.cells.len();
    let widths: Vec<u32> = nl.cells.iter().map(|c| cell(&c.typ).width).collect();
    let total: u32 = widths.iter().sum::<u32>().max(1);
    let util = 0.65;
    let side = ((total as f64 * SITE_W * ROW_H) / util).sqrt();
    let rows = ((side / ROW_H).round() as u32).max(1);
    let max_w = *widths.iter().max().unwrap_or(&1);
    let sites = ((total as f64 / util / rows as f64).ceil() as u32).max(max_w + 2);
    let (w, h) = (sites as f64 * SITE_W, rows as f64 * ROW_H);

    // IO pins evenly around the die: inputs on the left and top, outputs right and bottom
    let mut pins = vec![];
    let ins: Vec<(String, Bit)> = nl.ports.iter().filter(|p| p.dir == Dir::In).flat_map(|p| p.bits.iter().enumerate().map(move |(i, b)| (if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() }, *b))).collect();
    let outs: Vec<(String, Bit)> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.iter().enumerate().map(move |(i, b)| (if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() }, *b))).collect();
    let around = |k: usize, n: usize, first: bool| -> (f64, f64) {
        // half of the perimeter: left then top (inputs), right then bottom (outputs)
        let len = w + h;
        let d = (k as f64 + 0.5) / n as f64 * len;
        if first { if d < h { (0.0, h - d) } else { (d - h, h) } } else if d < h { (w, d) } else { (w - (d - h), 0.0) }
    };
    for (k, (name, b)) in ins.iter().enumerate() { let (x, y) = around(k, ins.len(), true); pins.push(Pin { name: name.clone(), dir: Dir::In, x, y, bit: *b }); }
    for (k, (name, b)) in outs.iter().enumerate() { let (x, y) = around(k, outs.len(), false); pins.push(Pin { name: name.clone(), dir: Dir::Out, x, y, bit: *b }); }

    let special = special_nets(nl);
    let pnets: Vec<PNet> = nets(nl, &pins).into_iter().filter(|p| !special.contains(&p.bit)).collect();
    let mut cell_nets: Vec<Vec<usize>> = vec![vec![]; n];
    for (k, p) in pnets.iter().enumerate() { for &c in &p.cells { cell_nets[c].push(k); } }

    // initial: cells in netlist order (topological, so connected cells are near), rows filled evenly
    let mut occ: Vec<Vec<i32>> = vec![vec![-1; sites as usize]; rows as usize];
    let mut pos = vec![(0u32, 0u32); n];
    let per_row = total as f64 / rows as f64;
    let (mut r, mut acc, mut placed_in_row) = (0u32, 0.0f64, vec![]);
    let flush = |r: u32, list: &Vec<usize>, occ: &mut Vec<Vec<i32>>, pos: &mut Vec<(u32, u32)>| {
        let used: u32 = list.iter().map(|&c| widths[c]).sum();
        let gap = if list.is_empty() { 0.0 } else { (sites - used.min(sites)) as f64 / list.len() as f64 };
        let mut x = 0.0f64;
        for &c in list {
            let xs = (x.round() as u32).min(sites - widths[c]);
            // nudge right past anything already there
            let mut xs2 = xs;
            while xs2 + widths[c] <= sites && (xs2..xs2 + widths[c]).any(|s| occ[r as usize][s as usize] >= 0) { xs2 += 1; }
            if xs2 + widths[c] > sites { xs2 = (0..=sites - widths[c]).find(|&s| (s..s + widths[c]).all(|t| occ[r as usize][t as usize] < 0)).unwrap_or(0); }
            for s in xs2..xs2 + widths[c] { occ[r as usize][s as usize] = c as i32; }
            pos[c] = (r, xs2);
            x += widths[c] as f64 + gap;
        }
    };
    // snake order keeps neighbours of row ends close
    for c in 0..n {
        placed_in_row.push(c);
        acc += widths[c] as f64;
        if acc >= per_row * (r + 1) as f64 && r + 1 < rows {
            if r % 2 == 1 { placed_in_row.reverse(); }
            flush(r, &placed_in_row, &mut occ, &mut pos);
            placed_in_row.clear();
            r += 1;
        }
    }
    if r % 2 == 1 { placed_in_row.reverse(); }
    flush(r, &placed_in_row, &mut occ, &mut pos);

    // ---- annealing ----
    let cx = |c: usize, pos: &Vec<(u32, u32)>| ((pos[c].1 as f64 + widths[c] as f64 / 2.0) * SITE_W, (pos[c].0 as f64 + 0.5) * ROW_H);
    let hpwl = |k: usize, pos: &Vec<(u32, u32)>| -> f64 {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for &c in &pnets[k].cells { let (x, y) = cx(c, pos); x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
        for &p in &pnets[k].pins { let (x, y) = (pins[p].x, pins[p].y); x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
        (x1 - x0) + (y1 - y0)
    };
    let mut ncost: Vec<f64> = (0..pnets.len()).map(|k| hpwl(k, &pos)).collect();
    let mut cost: f64 = ncost.iter().sum();
    let mut history = vec![Frame { temp: 0.0, cost, accept: 1.0, pos: pos.clone() }];
    if n < 2 || pnets.is_empty() {
        return RowPlacement { rows, sites, w, h, pos, pins, history, util: total as f64 / (rows * sites) as f64 };
    }
    let mut rng = Rng::new(seed);
    let mut temp = {
        let mut d = vec![];
        for _ in 0..200 { let c = rng.below(n); d.push(cell_nets[c].iter().map(|k| ncost[*k]).sum::<f64>()); }
        let m = d.iter().sum::<f64>() / d.len() as f64;
        (d.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / d.len() as f64).sqrt().max(1.0)
    };
    let mut rlim = (rows.max(sites / 8)) as f64;
    let moves = (n * 12).max(2000);
    let free_run = |occ: &Vec<Vec<i32>>, r: u32, x: u32, w: u32, ignore: &[i32]| -> bool {
        x + w <= sites && (x..x + w).all(|s| { let o = occ[r as usize][s as usize]; o < 0 || ignore.contains(&o) })
    };
    let mut touched: Vec<usize> = vec![];
    let mut stamp = vec![0u32; pnets.len()];
    let mut gen = 0u32;
    for _round in 0..400 {
        let mut accepted = 0usize;
        for _ in 0..moves {
            let a = rng.below(n);
            let (ra, xa) = pos[a];
            let wa = widths[a];
            let rr = rlim.max(1.0) as i64;
            let r2 = (ra as i64 + rng.below((2 * rr + 1) as usize) as i64 - rr).clamp(0, rows as i64 - 1) as u32;
            let xr = (rr * 8).max(4);
            let x2 = (xa as i64 + rng.below((2 * xr + 1) as usize) as i64 - xr).clamp(0, (sites - wa) as i64) as u32;
            if (r2, x2) == (ra, xa) { continue; }
            // target: free space, or a single cell we can swap with
            let b = occ[r2 as usize][x2 as usize];
            let mut plan: Vec<(usize, u32, u32)> = vec![];
            if free_run(&occ, r2, x2, wa, &[a as i32]) {
                plan.push((a, r2, x2));
            } else if b >= 0 && b as usize != a {
                let b = b as usize;
                let (rb, xb) = pos[b];
                let wb = widths[b];
                let ig = [a as i32, b as i32];
                // in the same row the two new spans must not overlap each other
                let clash = ra == rb && xb < xa + wb && xa < xb + wa;
                if free_run(&occ, rb, xb, wa, &ig) && free_run(&occ, ra, xa, wb, &ig) && !clash {
                    plan.push((a, rb, xb));
                    plan.push((b, ra, xa));
                } else { continue; }
            } else { continue; }
            // apply
            let old: Vec<(usize, (u32, u32))> = plan.iter().map(|(c, _, _)| (*c, pos[*c])).collect();
            for (c, _, _) in &plan { let (r, x) = pos[*c]; for s in x..x + widths[*c] { occ[r as usize][s as usize] = -1; } }
            for &(c, r, x) in &plan { pos[c] = (r, x); for s in x..x + widths[c] { occ[r as usize][s as usize] = c as i32; } }
            gen += 1;
            touched.clear();
            for (c, _, _) in &plan { for &k in &cell_nets[*c] { if stamp[k] != gen { stamp[k] = gen; touched.push(k); } } }
            let mut delta = 0.0;
            let newc: Vec<f64> = touched.iter().map(|&k| { let v = hpwl(k, &pos); delta += v - ncost[k]; v }).collect();
            if delta <= 0.0 || rng.unit() < (-delta / temp).exp() {
                for (i, &k) in touched.iter().enumerate() { ncost[k] = newc[i]; }
                cost += delta;
                accepted += 1;
            } else {
                for (c, _, _) in &plan { let (r, x) = pos[*c]; for s in x..x + widths[*c] { occ[r as usize][s as usize] = -1; } }
                for &(c, p) in &old { pos[c] = p; let (r, x) = p; for s in x..x + widths[c] { occ[r as usize][s as usize] = c as i32; } }
            }
        }
        let rate = accepted as f64 / moves as f64;
        history.push(Frame { temp, cost, accept: rate, pos: pos.clone() });
        temp *= if rate > 0.96 { 0.5 } else if rate > 0.8 { 0.9 } else if rate > 0.15 { 0.95 } else { 0.8 };
        rlim = (rlim * (1.0 - 0.44 + rate)).clamp(1.0, rows.max(sites / 8) as f64);
        if temp < 0.005 * cost.max(1.0) / pnets.len() as f64 { break; }
    }
    if history.len() > 40 {
        let m = history.len();
        let keep: std::collections::HashSet<usize> = (0..40).map(|i| i * (m - 1) / 39).collect();
        history = history.into_iter().enumerate().filter(|(i, _)| keep.contains(i)).map(|x| x.1).collect();
    }
    RowPlacement { rows, sites, w, h, pos, pins, history, util: total as f64 / (rows * sites) as f64 }
}
