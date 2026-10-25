//! Static timing analysis of a placed and routed iCE40 design.
//!
//! Delays (ns, slow corner) come from IceStorm's `timings_up5k.txt`:
//! logic-cell arcs (in_k -> lcout, carry, clk -> Q, setup) and one mux delay
//! per routing hop, chosen by the kind of wire the hop drives (the first hop
//! off a logic cell output onto a span uses the output driver instead).
//! The clock is ideal (global network, no skew); set/reset paths are not timed.

use super::chipdb::{Chip, Kind};
use super::pack::Packed;
use super::place::Placement;
use super::route::RNet;
use std::collections::HashMap;

const CLK_Q: f64 = 1.391;
const LUT: [f64; 4] = [1.285, 1.232, 1.205, 0.874];
const SETUP: [f64; 4] = [1.232, 1.060, 0.980, 0.728];
const CARRY_IN1: f64 = 0.675;
const CARRY_IN2: f64 = 0.609;
const CARRY_CIN: f64 = 0.278;
// block RAM: RCLK -> RDATA, setup of its inputs (SB_RAM40_4K in timings_up5k.txt)
const RAM_CLK_Q: f64 = 1.179;

/// setup time of a block RAM input pin
pub fn ram_setup(pin: &str) -> f64 {
    if pin.starts_with("RADDR") { 0.384 } else if pin.starts_with("WADDR") { 0.424 } else if pin.starts_with("WDATA") { 0.305 }
    else if pin.starts_with("MASK") { 0.517 } else if pin == "WE" { 0.252 } else if pin == "RE" { 0.185 } else { 0.503 }
}
// pad delays as icetime counts them (PRE_IO -> DIN0; output pad up to its input)
const IO_IN: f64 = 1.105;
const IO_OUT: f64 = 0.187;

/// where a wire meets the design
#[derive(Clone, Copy, Debug)]
pub enum Ep {
    LcOut(usize),
    LcIn(usize, u8),
    IoIn(usize),
    IoOut(usize),
    RamOut(usize),
    /// block RAM input with its setup time
    RamIn(usize, f64),
}

pub fn hop_delay(src: Kind, dst: Kind) -> f64 {
    let from_lc = src == Kind::LutOut;
    match dst {
        Kind::LutIn => 0.662,
        Kind::Local => 1.099,
        Kind::Ctrl => 0.636,
        Kind::Glb2Local => 0.583,
        Kind::Glb => 0.278,
        Kind::Sp4H => if from_lc { 0.649 } else { 0.543 },
        Kind::Sp4V => if from_lc { 0.649 } else { 0.596 },
        Kind::Sp12H => if from_lc { 1.232 } else { 1.231 },
        Kind::Sp12V => if from_lc { 1.232 } else { 1.072 },
        Kind::Carry => 0.556,
        Kind::Fabout => 0.0,
        Kind::Io => 0.0,
        Kind::LutOut | Kind::Other => 0.5,
    }
}

#[derive(Clone, Debug)]
pub struct Step {
    pub what: String,
    pub delay: f64,
    pub at: f64,
}

pub struct Timing {
    /// critical path delay including setup (ns)
    pub period: f64,
    pub fmax: f64,
    pub path: Vec<Step>,
    /// LCs and pips on the critical path
    pub crit_lcs: Vec<usize>,
    pub crit_pips: Vec<u32>,
    /// worst arrival at each LC output (ns)
    pub lc_arrival: Vec<f64>,
    pub endpoints: usize,
    /// per routed net: longest path through it / critical path (0..1)
    pub net_crit: Vec<f32>,
}

#[derive(Clone, Copy)]
enum From { None, Input(u8), Carry }

pub fn analyze(chip: &Chip, p: &Packed, pl: &Placement, nets: &[RNet], routes: &[Vec<u32>], eps: &HashMap<u32, Ep>, extra: usize) -> Timing {
    let is_extra = |pp: u32| pp >= u32::MAX - extra as u32;
    // per sink wire: (net, delay from the net source, pips from source to sink)
    let mut sink_route: HashMap<u32, (usize, f64, Vec<u32>)> = HashMap::new();
    for (ni, net) in nets.iter().enumerate() {
        if net.global.is_some() { continue; }
        let mut parent: HashMap<u32, u32> = HashMap::new();
        for &pp in &routes[ni] { if !is_extra(pp) { parent.insert(chip.pips[pp as usize].dst, pp); } }
        for &s in &net.sinks {
            let (mut w, mut d, mut path) = (s, 0.0, vec![]);
            while w != net.src {
                let Some(&pp) = parent.get(&w) else { break };
                let pip = &chip.pips[pp as usize];
                d += hop_delay(chip.kind[pip.src as usize], chip.kind[pip.dst as usize]);
                path.push(pp);
                w = pip.src;
            }
            path.reverse();
            sink_route.insert(s, (ni, d, path));
        }
    }
    // the sink wire feeding each LC input, and the source endpoint of each net
    let mut lc_in_wire: HashMap<(usize, u8), u32> = HashMap::new();
    let mut io_out_wire: HashMap<usize, u32> = HashMap::new();
    let mut ram_in_wires: Vec<(u32, usize, f64)> = vec![];
    for (&w, ep) in eps {
        match *ep {
            Ep::LcIn(l, k) => { lc_in_wire.insert((l, k), w); }
            Ep::IoOut(i) => { io_out_wire.insert(i, w); }
            Ep::RamIn(r, su) => ram_in_wires.push((w, r, su)),
            _ => {}
        }
    }
    ram_in_wires.sort_by_key(|x| x.0);
    let net_src: Vec<Ep> = nets.iter().map(|n| eps.get(&n.src).copied().unwrap_or(Ep::IoIn(usize::MAX))).collect();
    // carry chain neighbours
    let mut chain_prev: Vec<Option<usize>> = vec![None; p.lcs.len()];
    for ch in &p.chains { for w in ch.lcs.windows(2) { chain_prev[w[1]] = Some(w[0]); } }

    let n = p.lcs.len();
    let mut out_arr = vec![f64::NAN; n];
    let mut out_from = vec![From::None; n];
    let mut cout_arr = vec![f64::NAN; n];
    let mut cout_from = vec![From::None; n];
    // arrival at an LC input, and where it came from
    let input_arr = |l: usize, k: u8, out_arr: &Vec<f64>| -> Option<f64> {
        let w = lc_in_wire.get(&(l, k))?;
        let (ni, d, _) = sink_route.get(w)?;
        let s = match net_src[*ni] { Ep::LcOut(j) => out_arr[j], Ep::IoIn(_) => IO_IN, Ep::RamOut(_) => RAM_CLK_Q, _ => 0.0 };
        Some(s + d)
    };
    // evaluate in dependency order with an explicit stack
    let deps = |l: usize| -> Vec<usize> {
        let mut v = vec![];
        for k in 0..4u8 {
            if let Some(w) = lc_in_wire.get(&(l, k)) {
                if let Some((ni, _, _)) = sink_route.get(w) { if let Ep::LcOut(j) = net_src[*ni] { v.push(j); } }
            }
        }
        if let Some(pv) = chain_prev[l] { v.push(pv); }
        v
    };
    for start in 0..n {
        if !out_arr[start].is_nan() { continue; }
        let mut stack = vec![(start, false)];
        while let Some((l, done)) = stack.pop() {
            if !out_arr[l].is_nan() { continue; }
            let lc = &p.lcs[l];
            if !done {
                stack.push((l, true));
                if lc.ff.is_none() { for d in deps(l) { if out_arr[d].is_nan() { stack.push((d, false)); } } }
                else if let Some(pv) = chain_prev[l] { if out_arr[pv].is_nan() { stack.push((pv, false)); } }
                continue;
            }
            // carry-in arrival
            let cin = match chain_prev[l] { Some(pv) => cout_arr[pv], None => 0.0 };
            let mut best = (0.0f64, From::None);
            for k in 0..4u8 {
                if let Some(a) = input_arr(l, k, &out_arr) {
                    let a = if a.is_nan() { 0.0 } else { a };
                    let v = a + LUT[k as usize];
                    if v > best.0 { best = (v, From::Input(k)); }
                }
            }
            if lc.in3_chain && cin + LUT[3] > best.0 { best = (cin + LUT[3], From::Carry); }
            if lc.carry {
                let mut c = (cin + CARRY_CIN, From::Carry);
                for (k, dl) in [(1u8, CARRY_IN1), (2u8, CARRY_IN2)] {
                    if let Some(a) = input_arr(l, k, &out_arr) { if a + dl > c.0 { c = (a + dl, From::Input(k)); } }
                }
                cout_arr[l] = c.0;
                cout_from[l] = c.1;
            }
            if lc.ff.is_some() { out_arr[l] = CLK_Q; out_from[l] = From::None; }
            else { out_arr[l] = best.0; out_from[l] = best.1; }
        }
    }

    // endpoints: flip-flop inputs (setup), block RAM inputs and output pins
    enum End { Ff(usize, u8), Io(usize), Ram(u32, usize, f64) }
    let mut worst = (0.0f64, None::<End>);
    let mut endpoints = 0;
    for (l, lc) in p.lcs.iter().enumerate() {
        if lc.ff.is_none() { continue; }
        for k in 0..4u8 {
            if let Some(a) = input_arr(l, k, &out_arr) {
                endpoints += 1;
                if a + SETUP[k as usize] > worst.0 { worst = (a + SETUP[k as usize], Some(End::Ff(l, k))); }
            }
        }
    }
    let src_arr = |ni: usize, out_arr: &Vec<f64>| -> f64 {
        match net_src[ni] { Ep::LcOut(j) => if out_arr[j].is_nan() { 0.0 } else { out_arr[j] }, Ep::IoIn(_) => IO_IN, Ep::RamOut(_) => RAM_CLK_Q, _ => 0.0 }
    };
    for &(w, r, su) in &ram_in_wires {
        if let Some((ni, d, _)) = sink_route.get(&w) {
            endpoints += 1;
            let t = src_arr(*ni, &out_arr) + d + su;
            if t > worst.0 { worst = (t, Some(End::Ram(w, r, su))); }
        }
    }
    for (&i, w) in &io_out_wire {
        if let Some((ni, d, _)) = sink_route.get(w) {
            endpoints += 1;
            let s = match net_src[*ni] { Ep::LcOut(j) => out_arr[j], Ep::IoIn(_) => IO_IN, Ep::RamOut(_) => RAM_CLK_Q, _ => 0.0 };
            if s + d + IO_OUT > worst.0 { worst = (s + d + IO_OUT, Some(End::Io(i))); }
        }
    }

    // walk the critical path back
    let loc = |l: usize| { let (x, y, z) = pl.lc[l]; format!("LC({},{},{})", x, y, z) };
    let mut rev: Vec<Step> = vec![];
    let mut crit_lcs = vec![];
    let mut crit_pips = vec![];
    let route_step = |w: u32, rev: &mut Vec<Step>, crit_pips: &mut Vec<u32>| -> Option<Ep> {
        let (ni, d, path) = sink_route.get(&w)?;
        crit_pips.extend(path.iter().copied());
        rev.push(Step { what: format!("繞線 {}（{} 段）", nets[*ni].name, path.len()), delay: *d, at: 0.0 });
        Some(net_src[*ni])
    };
    let mut cur: Option<Ep> = None;
    match worst.1 {
        Some(End::Ff(l, k)) => {
            rev.push(Step { what: format!("{} setup in{}", loc(l), k), delay: SETUP[k as usize], at: 0.0 });
            crit_lcs.push(l);
            cur = route_step(lc_in_wire[&(l, k)], &mut rev, &mut crit_pips);
        }
        Some(End::Ram(w, r, su)) => {
            let (x, y) = pl.ram[r];
            rev.push(Step { what: format!("RAM({},{}) {} setup", x, y, chip.label(w).rsplit('/').next().unwrap_or("")), delay: su, at: 0.0 });
            cur = route_step(w, &mut rev, &mut crit_pips);
        }
        Some(End::Io(i)) => {
            rev.push(Step { what: format!("輸出腳 {}", p.ios[i].name), delay: IO_OUT, at: 0.0 });
            cur = route_step(io_out_wire[&i], &mut rev, &mut crit_pips);
        }
        None => {}
    }
    // through the carry chain and LUTs back to a flip-flop or input pin
    let mut guard = 0;
    let mut via_carry: Option<usize> = None;
    while let Some(ep) = cur.take() {
        guard += 1;
        if guard > 10000 { break; }
        match ep {
            Ep::IoIn(i) => { rev.push(Step { what: format!("輸入腳 {}", p.ios.get(i).map(|o| o.name.as_str()).unwrap_or("?")), delay: IO_IN, at: 0.0 }); }
            Ep::RamOut(r) => { let (x, y) = pl.ram[r]; rev.push(Step { what: format!("RAM({},{}) clk→RDATA", x, y), delay: RAM_CLK_Q, at: 0.0 }); }
            Ep::LcOut(l) => {
                crit_lcs.push(l);
                if p.lcs[l].ff.is_some() { rev.push(Step { what: format!("{} clk→Q", loc(l)), delay: CLK_Q, at: 0.0 }); break; }
                match out_from[l] {
                    From::Input(k) => {
                        rev.push(Step { what: format!("{} in{}→out", loc(l), k), delay: LUT[k as usize], at: 0.0 });
                        cur = lc_in_wire.get(&(l, k)).and_then(|w| route_step(*w, &mut rev, &mut crit_pips));
                    }
                    From::Carry => {
                        rev.push(Step { what: format!("{} carry-in→out", loc(l)), delay: LUT[3], at: 0.0 });
                        via_carry = chain_prev[l];
                    }
                    From::None => {}
                }
            }
            _ => {}
        }
        // carry chain: follow cout arrivals down the chain
        while let Some(c) = via_carry.take() {
            crit_lcs.push(c);
            match cout_from[c] {
                From::Carry => {
                    rev.push(Step { what: format!("{} carry", loc(c)), delay: CARRY_CIN, at: 0.0 });
                    via_carry = chain_prev[c];
                }
                From::Input(k) => {
                    rev.push(Step { what: format!("{} in{}→carry", loc(c), k), delay: if k == 1 { CARRY_IN1 } else { CARRY_IN2 }, at: 0.0 });
                    cur = lc_in_wire.get(&(c, k)).and_then(|w| route_step(*w, &mut rev, &mut crit_pips));
                }
                From::None => {}
            }
        }
    }
    rev.reverse();
    let mut at = 0.0;
    for s in rev.iter_mut() { at += s.delay; s.at = at; }
    let period = worst.0.max(0.001);
    // ---- criticality: the longest path through each net, from the arrival
    // at its source and the longest delay after each sink (backward pass) ----
    let mut net_of_lc: Vec<Option<usize>> = vec![None; n];
    for (ni, e) in net_src.iter().enumerate() { if let Ep::LcOut(j) = e { net_of_lc[*j] = Some(ni); } }
    let mut chain_next: Vec<Option<usize>> = vec![None; n];
    for ch in &p.chains { for w in ch.lcs.windows(2) { chain_next[w[0]] = Some(w[1]); } }
    let mut tail_out: Vec<f64> = vec![f64::NAN; n];
    let mut tail_cout: Vec<f64> = vec![f64::NAN; n];
    // iterative post-order over the LC graph (sink LCs before their drivers)
    let sink_ep = |s: u32| eps.get(&s).copied();
    // 0 = new, 1 = on the stack, 2 = done (a loop through flip-flops is cut where it closes)
    let mut state = vec![0u8; n];
    for start in 0..n {
        if state[start] != 0 { continue; }
        let mut stack = vec![(start, false)];
        while let Some((l, done)) = stack.pop() {
            if state[l] == 2 || (state[l] == 1 && !done) { continue; }
            // LCs whose tails this one needs: combinational loads and the next chain LC
            let mut deps = vec![];
            if let Some(ni) = net_of_lc[l] {
                for &s in &nets[ni].sinks { if let Some(Ep::LcIn(j, _)) = sink_ep(s) { if p.lcs[j].ff.is_none() || p.lcs[j].carry { deps.push(j); } } }
            }
            if let Some(nx) = chain_next[l] { deps.push(nx); }
            if !done {
                state[l] = 1;
                stack.push((l, true));
                for d in deps { if state[d] == 0 { stack.push((d, false)); } }
                continue;
            }
            state[l] = 2;
            let t = |x: f64| if x.is_nan() { 0.0 } else { x };
            // carry-out: on to the next LC's carry-out, or its LUT through in_3
            let mut tc = 0.0f64;
            if let Some(nx) = chain_next[l] {
                tc = tc.max(CARRY_CIN + t(tail_cout[nx]));
                if p.lcs[nx].in3_chain && p.lcs[nx].ff.is_none() { tc = tc.max(LUT[3] + t(tail_out[nx])); }
                if p.lcs[nx].in3_chain && p.lcs[nx].ff.is_some() { tc = tc.max(SETUP[3]); }
            }
            tail_cout[l] = tc;
            let mut to = 0.0f64;
            if let Some(ni) = net_of_lc[l] {
                for &s in &nets[ni].sinks {
                    let d = sink_route.get(&s).map(|x| x.1).unwrap_or(0.0);
                    let after = match sink_ep(s) {
                        Some(Ep::LcIn(j, k)) => {
                            let lc = &p.lcs[j];
                            let mut a = if lc.ff.is_some() { SETUP[k as usize] } else { LUT[k as usize] + t(tail_out[j]) };
                            if lc.carry && (k == 1 || k == 2) { a = a.max(if k == 1 { CARRY_IN1 } else { CARRY_IN2 } + t(tail_cout[j])); }
                            a
                        }
                        Some(Ep::IoOut(_)) => IO_OUT,
                        Some(Ep::RamIn(_, su)) => su,
                        _ => 0.0,
                    };
                    to = to.max(d + after);
                }
            }
            tail_out[l] = to;
        }
    }
    let net_crit: Vec<f32> = nets.iter().enumerate().map(|(ni, net)| {
        if net.global.is_some() { return 0.0; }
        let src = src_arr(ni, &out_arr);
        let mut worst = 0.0f64;
        for &s in &net.sinks {
            let d = sink_route.get(&s).map(|x| x.1).unwrap_or(0.0);
            let after = match sink_ep(s) {
                Some(Ep::LcIn(j, k)) => {
                    let lc = &p.lcs[j];
                    let mut a = if lc.ff.is_some() { SETUP[k as usize] } else { LUT[k as usize] + if tail_out[j].is_nan() { 0.0 } else { tail_out[j] } };
                    if lc.carry && (k == 1 || k == 2) { a = a.max(if k == 1 { CARRY_IN1 } else { CARRY_IN2 } + if tail_cout[j].is_nan() { 0.0 } else { tail_cout[j] }); }
                    a
                }
                Some(Ep::IoOut(_)) => IO_OUT,
                Some(Ep::RamIn(_, su)) => su,
                _ => 0.0,
            };
            worst = worst.max(src + d + after);
        }
        (worst / period).min(1.0) as f32
    }).collect();
    Timing { period, fmax: 1000.0 / period, path: rev, crit_lcs, crit_pips, lc_arrival: out_arr.iter().map(|x| if x.is_nan() { 0.0 } else { *x }).collect(), endpoints, net_crit }
}
