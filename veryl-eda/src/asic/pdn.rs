//! Power distribution and filler cells.
//!
//! Every row boundary carries an M1 rail; rows alternate orientation, so
//! the rails alternate VSS (boundary 0, 2, ...) and VDD (1, 3, ...). Pairs of
//! vertical M5 straps (VDD, then VSS, each two tracks wide) run every
//! STRAP_PITCH and drop a via stack (M1-M2-M3-M4-M5) onto every rail of
//! their own net. The detailed router treats the straps and via stacks as
//! blockages. After placement every free site is filled with FILL cells
//! (8, 4, 2, 1 sites) so wells and rails run on unbroken. A library with a
//! well tap cell (SKY130) first gets taps in the free sites nearest to every
//! TAP_PITCH µm of each row (odd rows shifted by half), so that no cell is
//! more than TAP_MAX µm from a tap in its row.

use super::detail::{LAYERS, TRACKS};
use super::lib::{dims, site_w};
use super::place::RowPlacement;
use crate::netlist::Netlist;

/// strap pair pitch in tracks (40 µm)
pub const STRAP_PITCH: u32 = 80;
pub const STRAP_W: u32 = 2;
pub const FILLERS: [u32; 4] = [8, 4, 2, 1];

pub struct Pdn {
    /// row boundaries 0..=rows: VDD on odd ones, VSS on even ones
    pub rails: u32,
    /// straps: (first track x, VDD?)
    pub straps: Vec<(u32, bool)>,
    /// via stacks: (track x, track y, VDD?)
    pub vias: Vec<(u32, u32, bool)>,
    /// filler cells: (row, site, width in sites)
    pub fillers: Vec<(u32, u32, u32)>,
    /// well taps: (row, site)
    pub taps: Vec<(u32, u32)>,
    /// sites of cells farther than TAP_MAX from a tap in their row
    pub tap_viol: usize,
}

/// tap spacing (µm) and the largest allowed distance to one
pub const TAP_PITCH: f64 = 20.0;
pub const TAP_MAX: f64 = 14.0;

impl Pdn {
    /// grid nodes (layer, x, y) the signal router must not use
    pub fn blocked(&self, ny: u32) -> Vec<(usize, u32, u32)> {
        let mut v = vec![];
        for &(x, _) in &self.straps {
            for dx in 0..STRAP_W { for y in 0..ny { v.push((LAYERS - 1, x + dx, y)); } }
        }
        for &(x, y, _) in &self.vias { for l in 0..LAYERS - 1 { v.push((l, x, y)); } }
        v
    }
}

/// well taps for a library that has a tap cell: one every TAP_PITCH µm of each
/// row (odd rows shifted by half a pitch) in a free site; where the row is
/// full there, the cells between the nearest cell edge and the nearest free
/// site move over by the tap's width to open one. Returns (row, site) of each tap.
pub fn insert_taps(nl: &Netlist, pl: &mut RowPlacement) -> Vec<(u32, u32)> {
    let tech = crate::pdk::tech();
    let Some((_, tw, _)) = tech.tap.as_ref() else { return vec![] };
    let tw = *tw as i64;
    let pitch = (TAP_PITCH / tech.site_w).round() as i64;
    let n = pl.sites as i64;
    let mut taps = vec![];
    for r in 0..pl.rows {
        // cells of this row by left edge
        let mut row: Vec<(i64, i64, usize)> = (0..nl.cells.len()).filter(|&i| pl.pos[i].0 == r && dims(&nl.cells[i]).1 == 1).map(|i| (pl.pos[i].1 as i64, dims(&nl.cells[i]).0 as i64, i)).collect();
        row.sort();
        let mut tap_x: Vec<i64> = vec![];
        let mut ideal: Vec<i64> = vec![];
        let mut x = if r % 2 == 1 { pitch / 2 } else { pitch / 4 };
        while x < n { ideal.push(x); x += pitch; }
        if ideal.last().map(|l| n - 1 - l > pitch / 2) == Some(true) { ideal.push(n - 1 - tw); }
        for x in ideal {
            let used = |s: i64, row: &Vec<(i64, i64, usize)>, taps: &Vec<i64>| row.iter().any(|c| s >= c.0 && s < c.0 + c.1) || taps.iter().any(|t| s >= *t && s < t + tw);
            let fits = |s: i64, row: &Vec<(i64, i64, usize)>, taps: &Vec<i64>| s >= 0 && s + tw <= n && (s..s + tw).all(|q| !used(q, row, taps));
            if let Some(s) = (0..6).flat_map(|d| [x - d, x + d]).find(|&s| fits(s, &row, &tap_x)) { tap_x.push(s); continue; }
            // open a gap: the cell edge nearest x, the nearest free run of tw sites to its right (or left), shift between
            let free_right = (x..n - tw + 1).find(|&s| fits(s, &row, &tap_x));
            let free_left = (0..=x).rev().find(|&s| fits(s, &row, &tap_x));
            // the cell covering x: open the gap at its nearer edge (left edge: shift right; right edge: shift left)
            let cover = row.iter().find(|c| x >= c.0 && x < c.0 + c.1).copied();
            let prefer_right = cover.map(|c| x - c.0 <= c.0 + c.1 - x).unwrap_or(true);
            let go_right = match (free_right, free_left) { (Some(_), Some(_)) => prefer_right, (Some(_), None) => true, _ => false };
            if go_right {
                let f = free_right.unwrap();
                // the left edge of the first cell at or after x - (its width): the cell covering x moves too
                let start = row.iter().filter(|c| c.0 + c.1 > x).map(|c| c.0).min().unwrap_or(x).min(f);
                for c in row.iter_mut() { if c.0 >= start && c.0 < f { c.0 += tw; } }
                for t in tap_x.iter_mut() { if *t >= start && *t < f { *t += tw; } }
                tap_x.push(start);
            } else if let Some(f) = free_left {
                // shift the cells left of x leftwards: the cell covering x stays, its left edge frees up
                let end = row.iter().filter(|c| c.0 <= x).map(|c| c.0 + c.1).max().unwrap_or(x).max(f + tw);
                for c in row.iter_mut() { if c.0 + c.1 <= end && c.0 > f { c.0 -= tw; } }
                for t in tap_x.iter_mut() { if *t + tw <= end && *t > f { *t -= tw; } }
                tap_x.push(end - tw);
            }
        }
        for c in &row { pl.pos[c.2].1 = c.0 as u32; }
        for t in tap_x { taps.push((r, t as u32)); }
    }
    taps
}

/// sites of cells farther than TAP_MAX from every tap in their row
pub fn tap_violations(nl: &Netlist, pl: &RowPlacement, taps: &[(u32, u32)]) -> usize {
    let tech = crate::pdk::tech();
    if tech.tap.is_none() { return 0; }
    let max = (TAP_MAX / tech.site_w).floor() as i64;
    let mut v = 0;
    for (i, c) in nl.cells.iter().enumerate() {
        let (r, x) = pl.pos[i];
        let w = dims(c).0 as i64;
        for s in x as i64..x as i64 + w {
            if !taps.iter().any(|&(tr, tx)| tr == r && (tx as i64 - s).abs() <= max) { v += 1; }
        }
    }
    v
}

pub fn build(nl: &Netlist, pl: &RowPlacement, taps: &[(u32, u32)]) -> Pdn {
    let nx = pl.sites + 1;
    // IO pins sit on M5 at the die edge: keep straps off their columns
    let io_cols: Vec<u32> = pl.pins.iter().map(|p| (p.x / site_w()).round() as u32).collect();
    let clear = |x: u32| (0..STRAP_W * 2 + 2).all(|d| !io_cols.contains(&(x + d)));
    let mut straps = vec![];
    let pairs = (nx / STRAP_PITCH).max(1);
    for k in 0..pairs {
        // centre each pair in its pitch, shifted off IO pin columns
        let mut x = (k * nx) / pairs + nx / pairs / 2;
        while x + 2 * STRAP_W + 2 < nx && !clear(x) { x += 1; }
        if x + 2 * STRAP_W + 2 >= nx { continue; }
        straps.push((x, true));
        straps.push((x + STRAP_W + 2, false));
    }
    let mut vias = vec![];
    for r in 0..=pl.rows {
        let vdd = r % 2 == 1;
        for &(x, sv) in &straps {
            if sv == vdd { for dx in 0..STRAP_W { vias.push((x + dx, r * TRACKS, vdd)); } }
        }
    }
    // fillers in every free run of sites
    let mut occ = vec![vec![false; pl.sites as usize]; pl.rows as usize];
    for (i, c) in nl.cells.iter().enumerate() {
        let (w, h) = dims(c);
        let (r, x) = pl.pos[i];
        for rr in r..(r + h).min(pl.rows) { for s in x..(x + w).min(pl.sites) { occ[rr as usize][s as usize] = true; } }
    }
    // well taps (placed by insert_taps)
    let tw = crate::pdk::tech().tap.as_ref().map(|t| t.1).unwrap_or(1);
    for &(r, x) in taps { for t in x..(x + tw).min(pl.sites) { occ[r as usize][t as usize] = true; } }
    let tap_viol = tap_violations(nl, pl, taps);
    let mut fillers = vec![];
    for r in 0..pl.rows {
        let mut s = 0;
        while s < pl.sites {
            if occ[r as usize][s as usize] { s += 1; continue; }
            let run = (s..pl.sites).take_while(|&t| !occ[r as usize][t as usize]).count() as u32;
            let mut left = run;
            let mut x = s;
            while left > 0 {
                let w = *FILLERS.iter().find(|&&f| f <= left).unwrap();
                fillers.push((r, x, w));
                x += w;
                left -= w;
            }
            s += run;
        }
    }
    Pdn { rails: pl.rows + 1, straps, vias, fillers, taps: taps.to_vec(), tap_viol }
}
