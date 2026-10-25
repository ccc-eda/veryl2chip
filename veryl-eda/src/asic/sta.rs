//! Static timing for the standard-cell netlist: cell delay = intrinsic +
//! load × fanout; wire delay to each sink = the driver charging the whole
//! routed net + a distributed RC term over the driver-to-sink distance. Paths start at input ports and
//! flip-flop outputs (clock -> Q) and end at flip-flop D pins (+ setup) and
//! output ports. Clock and asynchronous set/reset nets are not timed.

use super::lib::cell;
use super::lib::{ROW_H, SITE_W};
use super::place::RowPlacement;
use super::route::Routing;
use crate::netlist::{is_out, Bit, Dir, Netlist};
use crate::pnr::sta::Step;
use std::collections::HashMap;

/// wire delay (ns) to a sink `dist` µm from the driver on a net with `len` µm of metal
pub fn wire_delay(len: f64, dist: f64) -> f64 { 0.00015 * len + 0.0004 * dist + 1.0e-6 * dist * dist }

pub struct Timing {
    pub period: f64,
    pub fmax: f64,
    pub path: Vec<Step>,
    pub crit_cells: Vec<usize>,
    pub crit_nets: Vec<Bit>,
    /// arrival time at each cell's output (ns)
    pub arrival: Vec<f64>,
    pub endpoints: usize,
}

pub fn analyze(nl: &Netlist, pl: &RowPlacement, rt: &Routing) -> Timing {
    let len: HashMap<Bit, f64> = rt.nets.iter().map(|n| (n.bit, n.length)).collect();
    let mut fanout: HashMap<Bit, u32> = HashMap::new();
    for c in &nl.cells { for (p, b) in &c.conns { if !is_out(p) { *fanout.entry(*b).or_default() += 1; } } }
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) { for b in &p.bits { *fanout.entry(*b).or_default() += 1; } }
    let driver: HashMap<Bit, usize> = nl.cells.iter().enumerate().map(|(i, c)| (c.out(), i)).collect();
    let input_name: HashMap<Bit, String> = nl.ports.iter().filter(|p| p.dir == Dir::In)
        .flat_map(|p| p.bits.iter().enumerate().map(move |(i, b)| (*b, if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() }))).collect();
    let n = nl.cells.len();
    let at = |i: usize| { let (r, x) = pl.pos[i]; ((x as f64 + cell(&nl.cells[i].typ).width as f64 / 2.0) * SITE_W, (r as f64 + 0.5) * ROW_H) };
    let pin_at: HashMap<Bit, (f64, f64)> = pl.pins.iter().map(|p| (p.bit, (p.x, p.y))).collect();
    // where each net starts: its driver cell or input pin
    let src = |b: Bit| -> (f64, f64) { driver.get(&b).map(|&i| at(i)).or_else(|| pin_at.get(&b).copied()).unwrap_or((0.0, 0.0)) };
    let wire = |b: Bit, to: (f64, f64)| { let s = src(b); wire_delay(*len.get(&b).unwrap_or(&0.0), (s.0 - to.0).abs() + (s.1 - to.1).abs()) };
    let mut arrival = vec![0.0f64; n];
    // time each net leaves its driver (output of a cell, or 0 at an input pin)
    let mut net_at: HashMap<Bit, f64> = HashMap::new();
    let out_delay = |i: usize| { let c = &nl.cells[i]; let l = cell(&c.typ); l.delay + l.load * *fanout.get(&c.out()).unwrap_or(&0) as f64 };
    for (b, _) in &input_name { net_at.insert(*b, 0.0); }
    // flip-flop outputs first (the netlist keeps them last), then gates in order
    let mut pred: Vec<Option<Bit>> = vec![None; n];
    for (i, c) in nl.cells.iter().enumerate() {
        if c.is_ff() { arrival[i] = out_delay(i); net_at.insert(c.out(), arrival[i]); }
    }
    for (i, c) in nl.cells.iter().enumerate() {
        if c.is_ff() { continue; }
        let mut best: (f64, Option<Bit>) = (0.0, None);
        for (p, b) in &c.conns {
            if is_out(p) || b.is_const() { continue; }
            let t = *net_at.get(b).unwrap_or(&0.0) + wire(*b, at(i));
            if best.1.is_none() || t > best.0 { best = (t, Some(*b)); }
        }
        arrival[i] = best.0 + out_delay(i);
        pred[i] = best.1;
        net_at.insert(c.out(), arrival[i]);
    }
    // endpoints
    let mut worst: (f64, Option<Bit>, String, f64) = (0.0, None, String::new(), 0.0);
    let mut endpoints = 0;
    // the cell / pin a path ends at, to measure the last wire
    let mut end_at = (0.0, 0.0);
    for (i, c) in nl.cells.iter().enumerate().filter(|(_, c)| c.is_ff()) {
        let d = c.port("D").unwrap();
        if d.is_const() { continue; }
        endpoints += 1;
        let su = cell(&c.typ).setup;
        let t = net_at.get(&d).unwrap_or(&0.0) + wire(d, at(i)) + su;
        if t > worst.0 { worst = (t, Some(d), format!("{} D (setup)", c.typ), su); end_at = at(i); }
    }
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) {
        for (k, b) in p.bits.iter().enumerate() {
            if b.is_const() { continue; }
            endpoints += 1;
            let pa = pin_at.get(b).copied().unwrap_or((0.0, 0.0));
            let t = *net_at.get(b).unwrap_or(&0.0) + wire(*b, pa);
            if t > worst.0 { end_at = pa; worst = (t, Some(*b), if p.bits.len() > 1 { format!("output {}[{}]", p.name, k) } else { format!("output {}", p.name) }, 0.0); }
        }
    }
    // walk the critical path back
    let mut steps: Vec<Step> = vec![];
    let (mut crit_cells, mut crit_nets) = (vec![], vec![]);
    if let Some(mut b) = worst.1 {
        steps.push(Step { what: worst.2.clone(), delay: worst.3, at: worst.0 });
        let mut to = end_at;
        loop {
            crit_nets.push(b);
            let w = wire(b, to);
            let s = src(b);
            let label = format!("wire {:.0} µm (net {:.0} µm)", (s.0 - to.0).abs() + (s.1 - to.1).abs(), len.get(&b).unwrap_or(&0.0));
            match driver.get(&b) {
                Some(&i) => {
                    let c = &nl.cells[i];
                    steps.push(Step { what: label, delay: w, at: arrival[i] + w });
                    steps.push(Step { what: format!("{}{}", c.typ, if c.is_ff() { " clk→Q" } else { "" }), delay: out_delay(i), at: arrival[i] });
                    crit_cells.push(i);
                    to = at(i);
                    match pred[i] { Some(p) if !c.is_ff() => b = p, _ => break }
                }
                None => {
                    steps.push(Step { what: label, delay: w, at: w });
                    steps.push(Step { what: format!("input {}", input_name.get(&b).cloned().unwrap_or_default()), delay: 0.0, at: 0.0 });
                    break;
                }
            }
        }
        steps.reverse();
    }
    let period = worst.0.max(0.001);
    Timing { period, fmax: 1000.0 / period, path: steps, crit_cells, crit_nets, arrival, endpoints }
}
