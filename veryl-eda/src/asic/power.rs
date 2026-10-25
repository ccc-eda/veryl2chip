//! Power estimate and IR drop for the placed and routed design.
//!
//! - switching: every net that toggles (activity from a random-input
//!   simulation) charges its capacitance: sink pin caps (bigger cells have
//!   bigger inputs) + 0.2 fF per µm of routed wire; E = ½·C·V² per toggle.
//!   The clock tree switches twice per cycle;
//! - internal: energy inside a cell per output toggle (∝ cell size), plus
//!   every flip-flop's clocking energy per cycle and the SRAM accesses;
//! - leakage: ∝ cell size (SRAM: per bit).
//!
//! IR drop: each cell draws its average current from the VDD rail of its
//! row (and returns it on the VSS rail); a rail segment between two straps
//! is a resistive line fed at both ends (only one end before the first /
//! after the last strap), so a load I at distance x0 from one end of a
//! segment of length L drops the voltage at x by r·I·min(x,x0)·(L−max(x,x0))/L.

use super::lib::{dims, ROW_H, SITE_W};
use super::pdn::{Pdn, STRAP_W};
use super::place::RowPlacement;
use crate::netlist::{is_out, Bit, Netlist};
use crate::power::Activity;
use std::collections::{HashMap, HashSet};

pub const VDD: f64 = 1.2;
/// fF per µm of wire, Ω per µm of M1 rail (0.08 Ω/□, 0.4 µm wide)
const WIRE_CAP: f64 = 0.2;
const RAIL_R: f64 = 0.2;

fn pin_cap(typ: &str, pin: &str, width: u32) -> f64 {
    match (typ, pin) {
        (_, "CK") => 2.5,
        ("SRAM", _) => 2.0,
        _ => 1.0 + 0.15 * width as f64,
    }
}

pub struct Power {
    pub freq_mhz: f64,
    /// energy per clock cycle (pJ): nets, clock tree, cell internal, SRAM
    pub e_nets: f64,
    pub e_clock: f64,
    pub e_internal: f64,
    pub e_sram: f64,
    /// mW at freq_mhz
    pub dynamic: f64,
    pub leakage: f64,
    pub total: f64,
    /// average power per cell (µW), for a heat map
    pub cell: Vec<f64>,
    /// IR drop per cell (mV, VDD droop + VSS bounce) and the worst
    pub ir: Vec<f64>,
    pub ir_worst: f64,
    pub cycles: usize,
}

pub fn estimate(nl: &Netlist, pl: &RowPlacement, lengths: &HashMap<Bit, f64>, pdn: &Pdn, act: &Activity, freq_mhz: f64) -> Power {
    let n = nl.cells.len();
    let v2 = VDD * VDD;
    // clock nets: from the CK pins back through the clock buffers
    let mut clock: HashSet<Bit> = nl.cells.iter().filter_map(|c| c.port("CK")).collect();
    loop {
        let more: Vec<Bit> = nl.cells.iter().filter(|c| c.typ == "CLKBUF" && clock.contains(&c.out())).filter_map(|c| c.port("A")).filter(|b| !clock.contains(b)).collect();
        if more.is_empty() { break; }
        clock.extend(more);
    }
    // capacitance of every net, and which cells load it
    let mut cap: HashMap<Bit, f64> = HashMap::new();
    let mut driver: HashMap<Bit, usize> = HashMap::new();
    for (i, c) in nl.cells.iter().enumerate() {
        let w = dims(c).0;
        for (p, b) in &c.conns {
            if b.is_const() { continue; }
            if is_out(p) { driver.insert(*b, i); } else { *cap.entry(*b).or_default() += pin_cap(&c.typ, p, w); }
        }
    }
    for (b, l) in lengths { *cap.entry(*b).or_default() += WIRE_CAP * l; }
    // energy per cycle (fJ), charged to the driving cell (or spread for inputs)
    let mut cell_fj = vec![0.0f64; n];
    let (mut e_nets, mut e_clock, mut e_int, mut e_sram) = (0.0, 0.0, 0.0, 0.0);
    for (b, c) in &cap {
        let rate = if clock.contains(b) { 2.0 } else { act.rate.get(b).copied().unwrap_or(0.0) };
        let e = 0.5 * c * v2 * rate;
        if clock.contains(b) { e_clock += e } else { e_nets += e }
        if let Some(&d) = driver.get(b) { cell_fj[d] += e; }
    }
    for (i, c) in nl.cells.iter().enumerate() {
        let w = dims(c).0 as f64;
        let mut e = 0.0;
        if c.typ == "SRAM" {
            let (depth, width) = (super::lib::param(c, "DEPTH") as f64, super::lib::param(c, "WIDTH") as f64);
            let (r, wr) = act.ram.get(&i).copied().unwrap_or((0.0, 0.0));
            // an access drives word line, bit lines and sense amps: ∝ width × √depth
            let ea = 0.08 * width * depth.sqrt();
            let es = (r + wr) * ea;
            e_sram += es;
            cell_fj[i] += es;
            continue;
        }
        if c.is_ff() { e += 3.0; } // clocking every cycle
        if c.typ == "CLKBUF" { e += 0.4 * w * 2.0; } else {
            let rate = act.rate.get(&c.out()).copied().unwrap_or(0.0);
            e += 0.4 * w * rate;
        }
        e_int += e;
        cell_fj[i] += e;
    }
    let f = freq_mhz * 1e6;
    // leakage (nW): 0.25 per site of standard cell, 0.02 per SRAM bit
    let leak_nw: Vec<f64> = nl.cells.iter().map(|c| if c.typ == "SRAM" { 0.02 * (super::lib::param(c, "DEPTH") * super::lib::param(c, "WIDTH")) as f64 } else { 0.25 * dims(c).0 as f64 }).collect();
    let cell: Vec<f64> = (0..n).map(|i| cell_fj[i] * 1e-15 * f * 1e6 + leak_nw[i] * 1e-3).collect(); // µW
    let dynamic = (e_nets + e_clock + e_int + e_sram) * 1e-15 * f * 1e3; // mW
    let leakage = leak_nw.iter().sum::<f64>() * 1e-6;
    // ---- IR drop on the rails ----
    let straps_vdd: Vec<f64> = { let mut v: Vec<f64> = pdn.straps.iter().filter(|s| s.1).map(|s| (s.0 as f64 + STRAP_W as f64 / 2.0) * SITE_W).collect(); v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v };
    let straps_vss: Vec<f64> = { let mut v: Vec<f64> = pdn.straps.iter().filter(|s| !s.1).map(|s| (s.0 as f64 + STRAP_W as f64 / 2.0) * SITE_W).collect(); v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v };
    let centre = |i: usize| { let (w, _) = dims(&nl.cells[i]); let (_, x) = pl.pos[i]; (x as f64 + w as f64 / 2.0) * SITE_W };
    // loads per rail: rows r and r+1 share boundary r+1
    let mut rail_loads: HashMap<u32, Vec<(usize, f64)>> = HashMap::new();
    for i in 0..n {
        let (w, h) = dims(&nl.cells[i]);
        let _ = w;
        let (r, _) = pl.pos[i];
        let amps = cell[i] * 1e-6 / VDD;
        // a macro spreads its current over the rails it spans
        let rails: Vec<u32> = (r..=r + h).collect();
        for k in &rails { rail_loads.entry(*k).or_default().push((i, amps / rails.len() as f64 * 2.0)); }
    }
    let mut ir = vec![0.0f64; n];
    for (k, loads) in &rail_loads {
        let straps = if k % 2 == 1 { &straps_vdd } else { &straps_vss };
        if straps.is_empty() { continue; }
        // segments: [edge, s0], [s0, s1], ..., [s_last, edge]
        let mut cuts = vec![f64::NEG_INFINITY];
        cuts.extend(straps.iter().copied());
        cuts.push(f64::INFINITY);
        for seg in cuts.windows(2) {
            let (a, b) = (seg[0], seg[1]);
            let inside: Vec<(usize, f64, f64)> = loads.iter().map(|&(i, amp)| (i, centre(i), amp)).filter(|(_, x, _)| *x >= a && *x < b).collect();
            for &(i, x, _) in &inside {
                let mut drop = 0.0;
                for &(_, x0, amp) in &inside {
                    drop += if a.is_infinite() { amp * RAIL_R * (b - x.max(x0)) }       // fed at b only
                        else if b.is_infinite() { amp * RAIL_R * (x.min(x0) - a) }   // fed at a only
                        else { let l = b - a; amp * RAIL_R * (x.min(x0) - a) * (b - x.max(x0)) / l };
                }
                // a cell sees its VDD rail's droop plus its VSS rail's bounce
                ir[i] += drop * 1e3;
            }
        }
    }
    let ir_worst = ir.iter().copied().fold(0.0, f64::max);
    let _ = ROW_H;
    Power {
        freq_mhz, e_nets: e_nets / 1e3, e_clock: e_clock / 1e3, e_internal: e_int / 1e3, e_sram: e_sram / 1e3,
        dynamic, leakage, total: dynamic + leakage, cell, ir, ir_worst, cycles: act.cycles,
    }
}
