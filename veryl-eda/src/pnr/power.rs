//! A rough iCE40UP5K power estimate: every routed net that toggles charges
//! the inputs it drives (~5 fF each) and the routing it uses (~8 fF per
//! pip / wire segment); the clock's global network (~0.5 pF) switches twice
//! per cycle; flip-flops cost a little per clock; a block RAM access costs
//! ~24 pJ (about 20 µA/MHz at 1.2 V); static ≈ 75 µA × 1.2 V.

use super::route::RNet;
use crate::netlist::{Bit, Netlist};
use crate::power::Activity;

const V: f64 = 1.2;

pub struct FpgaPower {
    pub freq_mhz: f64,
    /// pJ per cycle: signal nets, clock network, block RAMs
    pub e_nets: f64,
    pub e_clock: f64,
    pub e_ram: f64,
    /// mW
    pub dynamic: f64,
    pub static_mw: f64,
    pub total: f64,
}

pub fn estimate(nl: &Netlist, nets: &[RNet], bits: &[Bit], routes: &[Vec<u32>], extra: usize, act: &Activity, freq_mhz: f64) -> FpgaPower {
    let (mut e_nets, mut e_clock) = (0.0, 0.0);
    for (i, net) in nets.iter().enumerate() {
        let pips = routes[i].iter().filter(|p| **p < u32::MAX - extra as u32).count() as f64;
        let c = 5.0 * net.sinks.len() as f64 + 8.0 * pips; // fF
        if net.global.is_some() && act.rate.get(&bits[i]).copied().unwrap_or(0.0) == 0.0 {
            // a clock: global network + the tiles' clock muxes, every cycle
            e_clock += (500.0 + c) * V * V;
        } else {
            e_nets += 0.5 * c * V * V * act.rate.get(&bits[i]).copied().unwrap_or(0.0);
        }
    }
    let ffs = nl.cells.iter().filter(|c| c.is_ff()).count() as f64;
    e_clock += ffs * 2.0;
    let e_ram: f64 = act.ram.values().map(|(r, w)| (r + w) * 24_000.0).sum::<f64>().max(0.0); // fJ
    let e = e_nets + e_clock + e_ram; // fJ per cycle
    let dynamic = e * 1e-15 * freq_mhz * 1e6 * 1e3;
    let static_mw = 75e-6 * V * 1e3;
    FpgaPower { freq_mhz, e_nets: e_nets / 1e3, e_clock: e_clock / 1e3, e_ram: e_ram / 1e3, dynamic, static_mw, total: dynamic + static_mw }
}
