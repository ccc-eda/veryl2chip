//! Switching activity for power estimation: the mapped netlist is simulated
//! (netsim) with random inputs; a reset input (a port named like "rst" /
//! "reset") is held active for two cycles first (its polarity is the one
//! under which the design moves more in a short trial). Every wire's toggles per
//! cycle are counted, and the read / write accesses of RAMs.

use crate::netlist::{Bit, Dir, Netlist};
use crate::netsim::NetSim;
use std::collections::HashMap;

pub struct Activity {
    pub cycles: usize,
    /// toggles per clock cycle of every wire that toggled
    pub rate: HashMap<Bit, f64>,
    /// per RAM / SRAM cell: (reads, writes) per cycle
    pub ram: HashMap<usize, (f64, f64)>,
}

pub fn activity(nl: &Netlist, cycles: usize, seed: u64) -> Activity {
    let has_reset = nl.ports.iter().any(|p| p.dir == Dir::In && { let l = p.name.to_lowercase(); l.contains("rst") || l.contains("reset") });
    if !has_reset { return run(nl, cycles, seed, true); }
    // which reset level lets the design run?
    let (lo, hi) = (run(nl, 40, seed, true), run(nl, 40, seed, false));
    let moves = |a: &Activity| a.rate.values().sum::<f64>();
    run(nl, cycles, seed, moves(&lo) >= moves(&hi))
}

/// `active_low`: the reset is asserted at 0 and released at 1
fn run(nl: &Netlist, cycles: usize, seed: u64, active_low: bool) -> Activity {
    let mut s = NetSim::new(nl);
    let ins: Vec<(&str, usize)> = nl.ports.iter().filter(|p| p.dir == Dir::In).map(|p| (p.name.as_str(), p.bits.len())).collect();
    let is_reset = |n: &str| { let l = n.to_lowercase(); l.contains("rst") || l.contains("reset") };
    let is_clock = |n: &str| { let l = n.to_lowercase(); l.contains("clk") || l.contains("clock") };
    let wires: Vec<Bit> = {
        let mut v: Vec<Bit> = nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied())).filter(|b| !b.is_const()).collect();
        v.sort();
        v.dedup();
        v
    };
    let mut x = seed | 1;
    let mut rnd = move || { x ^= x << 13; x ^= x >> 7; x ^= x << 17; x };
    let mut toggles = vec![0u32; wires.len()];
    let mut prev: Vec<bool> = vec![false; wires.len()];
    let rams: Vec<usize> = (0..nl.cells.len()).filter(|&i| matches!(nl.cells[i].typ.as_str(), "SB_RAM40_4K" | "SRAM")).collect();
    let mut acc: HashMap<usize, (u32, u32)> = HashMap::new();
    for cyc in 0..cycles + 2 {
        for &(n, w) in &ins {
            if is_clock(n) { continue; }
            let v = if is_reset(n) { if (cyc < 2) == active_low { 0 } else { u128::MAX } } else { (rnd() as u128) << 64 | rnd() as u128 };
            s.poke(n, if w >= 128 { v } else { v & ((1u128 << w) - 1) });
        }
        s.settle();
        for &i in &rams {
            let c = &nl.cells[i];
            let g = |p: &str| c.port(p).map(|b| s.bit(b)).unwrap_or(true);
            let (re, we) = if c.typ == "SRAM" { (g("RE"), g("WE")) } else { (g("RE") && g("RCLKE"), g("WE") && g("WCLKE")) };
            if cyc >= 2 { let e = acc.entry(i).or_default(); e.0 += re as u32; e.1 += we as u32; }
        }
        s.step();
        for (k, b) in wires.iter().enumerate() {
            let v = s.bit(*b);
            if cyc >= 2 && v != prev[k] { toggles[k] += 1; }
            prev[k] = v;
        }
    }
    let rate = wires.iter().zip(&toggles).filter(|(_, t)| **t > 0).map(|(b, t)| (*b, *t as f64 / cycles as f64)).collect();
    let ram = acc.into_iter().map(|(i, (r, w))| (i, (r as f64 / cycles as f64, w as f64 / cycles as f64))).collect();
    Activity { cycles, rate, ram }
}
