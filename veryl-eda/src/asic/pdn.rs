//! Power distribution and filler cells.
//!
//! Every row boundary carries an M1 rail; rows alternate orientation, so
//! the rails alternate VSS (boundary 0, 2, ...) and VDD (1, 3, ...). Pairs of
//! vertical M5 straps (VDD, then VSS, each two tracks wide) run every
//! STRAP_PITCH and drop a via stack (M1-M2-M3-M4-M5) onto every rail of
//! their own net. The detailed router treats the straps and via stacks as
//! blockages. After placement every free site is filled with FILL cells
//! (8, 4, 2, 1 sites) so wells and rails run on unbroken.

use super::detail::{LAYERS, TRACKS};
use super::lib::{dims, SITE_W};
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
}

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

pub fn build(nl: &Netlist, pl: &RowPlacement) -> Pdn {
    let nx = pl.sites + 1;
    // IO pins sit on M5 at the die edge: keep straps off their columns
    let io_cols: Vec<u32> = pl.pins.iter().map(|p| (p.x / SITE_W).round() as u32).collect();
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
    Pdn { rails: pl.rows + 1, straps, vias, fillers }
}
