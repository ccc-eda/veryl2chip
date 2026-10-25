//! Static timing for the standard-cell netlist: cell delay = intrinsic +
//! load × fanout; wire delay to each sink = the driver charging the whole
//! routed net + a distributed RC term over the driver-to-sink distance. Paths start at input ports and
//! flip-flop outputs (clock -> Q) and end at flip-flop D pins (+ setup) and
//! output ports. Once CTS has built the clock tree the clock is propagated:
//! each flip-flop has its own clock arrival (insertion delay through the
//! CLKBUFs and wires), a path launches at its source's clock arrival and is
//! checked against its capture clock (setup), and a min-delay pass checks
//! hold. Asynchronous set/reset nets are not timed.

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
    /// per net: longest path through it / critical path (0..1)
    pub net_crit: HashMap<Bit, f32>,
    /// propagated clock: largest clock arrival (insertion delay) and skew
    pub insertion: f64,
    pub skew: f64,
    /// worst hold slack, and the violating endpoints (cell, pin, slack)
    pub hold_slack: f64,
    pub hold_viol: Vec<(usize, &'static str, f64)>,
}

/// `extra_hold`: added to every hold requirement (to exercise hold fixing)
pub fn analyze(nl: &Netlist, pl: &RowPlacement, rt: &Routing, extra_hold: f64) -> Timing {
    let len: HashMap<Bit, f64> = rt.nets.iter().map(|n| (n.bit, n.length)).collect();
    let mut fanout: HashMap<Bit, u32> = HashMap::new();
    for c in &nl.cells { for (p, b) in &c.conns { if !is_out(p) { *fanout.entry(*b).or_default() += 1; } } }
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) { for b in &p.bits { *fanout.entry(*b).or_default() += 1; } }
    let driver: HashMap<Bit, usize> = nl.cells.iter().enumerate().flat_map(|(i, c)| c.conns.iter().filter(|(p, _)| is_out(p)).map(move |(_, b)| (*b, i))).collect();
    let input_name: HashMap<Bit, String> = nl.ports.iter().filter(|p| p.dir == Dir::In)
        .flat_map(|p| p.bits.iter().enumerate().map(move |(i, b)| (*b, if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() }))).collect();
    let n = nl.cells.len();
    let is_macro = |i: usize| nl.cells[i].typ == "SRAM";
    let at = |i: usize| { let (r, x) = pl.pos[i]; let (w, h) = super::lib::dims(&nl.cells[i]); ((x as f64 + w as f64 / 2.0) * SITE_W, (r as f64 + h as f64 / 2.0) * ROW_H) };
    let pin_at: HashMap<Bit, (f64, f64)> = pl.pins.iter().map(|p| (p.bit, (p.x, p.y))).collect();
    // where each net starts: its driver cell or input pin
    let src = |b: Bit| -> (f64, f64) { driver.get(&b).map(|&i| at(i)).or_else(|| pin_at.get(&b).copied()).unwrap_or((0.0, 0.0)) };
    let wire = |b: Bit, to: (f64, f64)| { let s = src(b); wire_delay(*len.get(&b).unwrap_or(&0.0), (s.0 - to.0).abs() + (s.1 - to.1).abs()) };
    let mut arrival = vec![0.0f64; n];
    // time each net leaves its driver (output of a cell, or 0 at an input pin)
    let mut net_at: HashMap<Bit, f64> = HashMap::new();
    let out_delay = |i: usize| {
        let c = &nl.cells[i];
        if c.typ == "SRAM" { return super::lib::SRAM_CLK_Q; }
        let l = cell(&c.typ);
        l.delay + l.load * *fanout.get(&c.out()).unwrap_or(&0) as f64
    };
    // ---- clock arrival at every flip-flop / macro (0 = ideal clock before CTS) ----
    let propagated = nl.cells.iter().any(|c| c.typ == "CLKBUF");
    let mut clk_at: HashMap<Bit, f64> = HashMap::new();
    for (i, c) in nl.cells.iter().enumerate().filter(|(_, c)| c.typ == "CLKBUF") {
        // tree buffers come parent first
        let a = c.port("A").unwrap();
        let t = clk_at.get(&a).copied().unwrap_or(0.0) + wire(a, at(i)) + out_delay(i);
        clk_at.insert(c.out(), t);
    }
    let ck_arr = |i: usize| -> f64 {
        if !propagated { return 0.0; }
        let Some(ck) = nl.cells[i].port("CK") else { return 0.0 };
        clk_at.get(&ck).copied().unwrap_or(0.0) + wire(ck, at(i))
    };
    let seq: Vec<usize> = (0..n).filter(|&i| nl.cells[i].is_ff() || is_macro(i)).collect();
    let cks: Vec<f64> = seq.iter().map(|&i| ck_arr(i)).collect();
    let insertion = cks.iter().copied().fold(0.0, f64::max);
    let skew = if cks.is_empty() { 0.0 } else { insertion - cks.iter().copied().fold(f64::MAX, f64::min) };
    // the outside world runs on a virtual clock with the tree's average latency:
    // inputs are launched and outputs captured at that time
    let io_clk = if cks.is_empty() { 0.0 } else { cks.iter().sum::<f64>() / cks.len() as f64 };
    let mut min_at: HashMap<Bit, f64> = HashMap::new();
    for (b, _) in &input_name { net_at.insert(*b, io_clk); min_at.insert(*b, io_clk); }
    // flip-flop outputs first (the netlist keeps them last), then gates in order
    let mut pred: Vec<Option<Bit>> = vec![None; n];
    for &i in &seq {
        let c = &nl.cells[i];
        arrival[i] = ck_arr(i) + out_delay(i);
        for (p, b) in &c.conns { if is_out(p) { net_at.insert(*b, arrival[i]); min_at.insert(*b, arrival[i]); } }
    }
    for (i, c) in nl.cells.iter().enumerate() {
        if c.is_ff() || is_macro(i) || c.typ == "CLKBUF" { continue; }
        let mut best: (f64, Option<Bit>) = (0.0, None);
        let mut early = f64::MAX;
        for (p, b) in &c.conns {
            if is_out(p) || b.is_const() { continue; }
            let w = wire(*b, at(i));
            let t = *net_at.get(b).unwrap_or(&0.0) + w;
            if best.1.is_none() || t > best.0 { best = (t, Some(*b)); }
            early = early.min(min_at.get(b).copied().unwrap_or(0.0) + w);
        }
        arrival[i] = best.0 + out_delay(i);
        pred[i] = best.1;
        net_at.insert(c.out(), arrival[i]);
        // a constant (tie cell) never changes: it cannot violate hold
        min_at.insert(c.out(), if early == f64::MAX { f64::INFINITY } else { early + out_delay(i) });
    }
    // endpoints
    let mut worst: (f64, Option<Bit>, String, f64) = (0.0, None, String::new(), 0.0);
    let mut endpoints = 0;
    // the cell / pin a path ends at, to measure the last wire
    let mut end_at = (0.0, 0.0);
    // setup against the capture clock, and hold (earliest data vs capture clock + hold)
    let mut cap_ck = 0.0;
    let mut hold_slack = f64::MAX;
    let mut hold_viol = vec![];
    for &i in &seq {
        let c = &nl.cells[i];
        let ck = ck_arr(i);
        for (p, d) in &c.conns {
            if is_out(p) || matches!(*p, "CK" | "RN" | "SN") || d.is_const() { continue; }
            endpoints += 1;
            let (su, ho) = if is_macro(i) { (super::lib::SRAM_SETUP, super::lib::SRAM_HOLD) } else { (cell(&c.typ).setup, super::lib::HOLD) };
            let w = wire(*d, at(i));
            let t = net_at.get(d).unwrap_or(&0.0) + w + su - ck;
            if t > worst.0 {
                worst = (t, Some(*d), if is_macro(i) { format!("SRAM {} (setup)", p) } else { format!("{} {} (setup)", c.typ, p) }, su);
                end_at = at(i);
                cap_ck = ck;
            }
            let slack = min_at.get(d).copied().unwrap_or(0.0) + w - (ck + ho + extra_hold);
            hold_slack = hold_slack.min(slack);
            if slack < 0.0 { hold_viol.push((i, *p, slack)); }
        }
    }
    if hold_slack == f64::MAX { hold_slack = 0.0; }
    for p in nl.ports.iter().filter(|p| p.dir == Dir::Out) {
        for (k, b) in p.bits.iter().enumerate() {
            if b.is_const() { continue; }
            endpoints += 1;
            let pa = pin_at.get(b).copied().unwrap_or((0.0, 0.0));
            let t = *net_at.get(b).unwrap_or(&0.0) + wire(*b, pa) - io_clk;
            if t > worst.0 { end_at = pa; cap_ck = io_clk; worst = (t, Some(*b), if p.bits.len() > 1 { format!("output {}[{}]", p.name, k) } else { format!("output {}", p.name) }, 0.0); }
        }
    }
    // walk the critical path back
    let mut steps: Vec<Step> = vec![];
    let (mut crit_cells, mut crit_nets) = (vec![], vec![]);
    if let Some(mut b) = worst.1 {
        if cap_ck > 0.0 { steps.push(Step { what: "capture clock".into(), delay: -cap_ck, at: worst.0 }); }
        steps.push(Step { what: worst.2.clone(), delay: worst.3, at: worst.0 + cap_ck });
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
                    steps.push(Step { what: format!("{}{}", c.typ, if c.is_ff() || is_macro(i) { " clk→Q" } else { "" }), delay: out_delay(i), at: arrival[i] });
                    crit_cells.push(i);
                    to = at(i);
                    match pred[i] { Some(p) if !c.is_ff() && !is_macro(i) => b = p, _ => {
                        let ck = ck_arr(i);
                        if ck > 0.0 { steps.push(Step { what: "launch clock (clock tree)".into(), delay: ck, at: ck }); }
                        break
                    } }
                }
                None => {
                    steps.push(Step { what: label, delay: w, at: io_clk + w });
                    steps.push(Step { what: format!("input {}", input_name.get(&b).cloned().unwrap_or_default()), delay: io_clk, at: io_clk });
                    break;
                }
            }
        }
        steps.reverse();
    }
    let period = worst.0.max(0.001);
    // criticality: arrival at each net + the longest delay after it (backward
    // over the cells, which are in topological order with flip-flops last)
    let mut users: HashMap<Bit, Vec<usize>> = HashMap::new();
    for (i, c) in nl.cells.iter().enumerate() {
        for (p, b) in &c.conns { if !is_out(p) && !b.is_const() && *p != "CK" && *p != "RN" && *p != "SN" { users.entry(*b).or_default().push(i); } }
    }
    let out_pins: HashMap<Bit, (f64, f64)> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.iter().map(|b| (*b, pin_at.get(b).copied().unwrap_or((0.0, 0.0))))).collect();
    let mut tail: HashMap<Bit, f64> = HashMap::new();
    let tail_of = |b: Bit, tail: &HashMap<Bit, f64>| -> f64 {
        let mut t = 0.0f64;
        for &j in users.get(&b).map(|v| v.as_slice()).unwrap_or(&[]) {
            let c = &nl.cells[j];
            let after = if c.is_ff() { cell(&c.typ).setup } else if is_macro(j) { super::lib::SRAM_SETUP } else { out_delay(j) + tail.get(&c.out()).copied().unwrap_or(0.0) };
            t = t.max(wire(b, at(j)) + after);
        }
        if let Some(pa) = out_pins.get(&b) { t = t.max(wire(b, *pa)); }
        t
    };
    for i in (0..n).rev() {
        let c = &nl.cells[i];
        if c.is_ff() || is_macro(i) { continue; }
        let t = tail_of(c.out(), &tail);
        tail.insert(c.out(), t);
    }
    let mut net_crit = HashMap::new();
    let sources: Vec<Bit> = nl.cells.iter().flat_map(|c| c.conns.iter().filter(|(p, _)| is_out(p)).map(|x| x.1)).chain(input_name.keys().copied()).collect();
    for b in sources {
        let t = match tail.get(&b) { Some(t) => *t, None => tail_of(b, &tail) };
        net_crit.insert(b, ((net_at.get(&b).copied().unwrap_or(0.0) + t) / period).min(1.0) as f32);
    }
    Timing { period, fmax: 1000.0 / period, path: steps, crit_cells, crit_nets, arrival, endpoints, net_crit, insertion, skew, hold_slack, hold_viol }
}
