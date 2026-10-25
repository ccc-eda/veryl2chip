//! ASIC back end on the "vlib" standard-cell library: technology mapping,
//! row placement (wirelength, then timing-driven), clock tree synthesis,
//! global routing, static timing with a propagated clock, hold fixing.

pub mod cts;
pub mod detail;
pub mod lib;
pub mod map;
pub mod place;
pub mod route;
pub mod sta;

use crate::netlist::Netlist;

pub struct Output {
    pub mapped: Netlist,
    pub placement: place::RowPlacement,
    pub routing: route::Routing,
    pub timing: sta::Timing,
    /// total cell area (µm²)
    pub area: f64,
    /// (cell type, count), largest count first
    pub counts: Vec<(String, usize)>,
    /// Fmax of the wirelength-only placement (before the timing-driven pass), ideal clock
    pub fmax_wl: f64,
    /// Fmax with the ideal clock, before CTS
    pub fmax_ideal: f64,
    pub cts: cts::Cts,
    /// delay buffers inserted to fix hold
    pub hold_bufs: usize,
    pub detail: detail::Detail,
}

pub fn flow(opt: &Netlist, seed: u64) -> Result<Output, String> { flow_with(opt, seed, 0.0) }

/// `extra_hold` (ns) is added to every hold requirement (tests use it to force hold fixing)
pub fn flow_with(opt: &Netlist, seed: u64, extra_hold: f64) -> Result<Output, String> {
    let t = |what: &str, t0: f64| if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("{}: {:.2}s", what, now() - t0) };
    let t0 = now();
    let mut mapped = map::map(opt)?;
    t("map", t0);
    let t0 = now();
    // utilization: start at 65 %; a design whose global routing overflows or
    // fills its gcell edges more than half on average gets a bigger die (the
    // track-level router needs the room for pins and vias)
    let mut util = 0.65;
    let (mut placement, mut routing);
    loop {
        placement = place::place(&mapped, seed, util, &Default::default(), None);
        t("place", t0);
        let t0 = now();
        // a short probe decides: a routable die needs few rounds
        let probe = route::route_with(&mapped, &placement, 8);
        if (probe.overflow > probe.iters[0] / 50 || probe.demand > 0.5) && util > 0.35 { util *= 0.8; continue; }
        routing = if probe.overflow == 0 { probe } else { route::route(&mapped, &placement) };
        t("route", t0);
        break;
    }
    let mut timing = sta::analyze(&mapped, &placement, &routing, extra_hold);
    // timing-driven pass: nets weighted by their criticality; keep the faster result
    let fmax_wl = timing.fmax;
    let weights = timing_weights(&mapped, &timing.net_crit);
    // a refinement of the first placement always; a fresh weighted anneal for
    // smaller designs as well (on large ones it tends to congest the routing)
    let mut tries = vec![Some(placement.pos.clone())];
    if mapped.cells.len() < 4000 { tries.push(None); }
    for start in tries {
        let t0 = now();
        let p2 = place::place(&mapped, seed, util, &weights, start.as_deref());
        t("place (timing-driven)", t0);
        let t0 = now();
        let r2 = route::route(&mapped, &p2);
        t("route (timing-driven)", t0);
        let t2 = sta::analyze(&mapped, &p2, &r2, extra_hold);
        // only a routable result counts
        if r2.overflow == 0 && t2.fmax > timing.fmax { placement = p2; routing = r2; timing = t2; }
    }
    let _ = routing;
    // clock tree on the final placement, then routing and timing with the propagated clock
    let fmax_ideal = timing.fmax;
    let t0 = now();
    let cts = cts::build(&mut mapped, &mut placement);
    t("cts", t0);
    let mut routing = route::route(&mapped, &placement);
    let mut timing = sta::analyze(&mapped, &placement, &routing, extra_hold);
    // hold: delay buffers (≈ 50 ps each) in front of violating inputs
    let mut hold_bufs = 0;
    for _ in 0..3 {
        if timing.hold_viol.is_empty() { break; }
        let fixes: Vec<(usize, &'static str, usize)> = timing.hold_viol.iter().map(|&(i, p, s)| (i, p, ((-s + 0.01) / 0.05).ceil().max(1.0) as usize)).collect();
        hold_bufs += cts::fix_hold(&mut mapped, &mut placement, &fixes);
        routing = route::route(&mapped, &placement);
        timing = sta::analyze(&mapped, &placement, &routing, extra_hold);
    }
    // detailed routing on the track grid; its wire lengths make the final timing
    let t0 = now();
    let detail = detail::route(&mapped, &placement, &routing);
    t("detail route", t0);
    let dlen: std::collections::HashMap<crate::netlist::Bit, f64> = detail.nets.iter().map(|n| (n.bit, n.length)).collect();
    for n in routing.nets.iter_mut() { if let Some(l) = dlen.get(&n.bit) { n.length = *l; } }
    let timing = sta::analyze(&mapped, &placement, &routing, extra_hold);
    let area = mapped.cells.iter().map(lib::cell_area).sum();
    let mut m: std::collections::BTreeMap<String, usize> = Default::default();
    for c in &mapped.cells { *m.entry(c.typ.clone()).or_default() += 1; }
    let mut counts: Vec<(String, usize)> = m.into_iter().collect();
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(Output { mapped, placement, routing, timing, area, counts, fmax_wl, fmax_ideal, cts, hold_bufs, detail })
}

#[cfg(not(target_arch = "wasm32"))]
fn now() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() }
#[cfg(target_arch = "wasm32")]
fn now() -> f64 { 0.0 }

/// the placement (and pins) as DEF, 1000 database units per µm
pub fn def(o: &Output) -> String {
    use std::fmt::Write;
    let pl = &o.placement;
    let u = |x: f64| (x * 1000.0).round() as i64;
    let mut s = String::new();
    writeln!(s, "VERSION 5.8 ;\nDIVIDERCHAR \"/\" ;\nBUSBITCHARS \"[]\" ;\nDESIGN {} ;\nUNITS DISTANCE MICRONS 1000 ;", o.mapped.name).unwrap();
    writeln!(s, "DIEAREA ( 0 0 ) ( {} {} ) ;", u(pl.w), u(pl.h)).unwrap();
    for r in 0..pl.rows {
        writeln!(s, "ROW ROW_{} core 0 {} {} DO {} BY 1 STEP {} 0 ;", r, u(r as f64 * lib::ROW_H), if r % 2 == 0 { "N" } else { "FS" }, pl.sites, u(lib::SITE_W)).unwrap();
    }
    writeln!(s, "COMPONENTS {} ;", o.mapped.cells.len()).unwrap();
    for (i, c) in o.mapped.cells.iter().enumerate() {
        let (r, x) = pl.pos[i];
        writeln!(s, "  - c{} {} + PLACED ( {} {} ) {} ;", i, c.typ, u(x as f64 * lib::SITE_W), u(r as f64 * lib::ROW_H), if r % 2 == 0 { "N" } else { "FS" }).unwrap();
    }
    writeln!(s, "END COMPONENTS\nPINS {} ;", pl.pins.len()).unwrap();
    for p in &pl.pins {
        writeln!(s, "  - {} + NET {} + DIRECTION {} + PLACED ( {} {} ) N ;", p.name, p.name, if p.dir == crate::netlist::Dir::In { "INPUT" } else { "OUTPUT" }, u(p.x), u(p.y)).unwrap();
    }
    writeln!(s, "END PINS").unwrap();
    // detailed routes: wires per layer and vias (VIA12 = M1 pin to M2, VIA23 ...)
    let t = lib::ROW_H / detail::TRACKS as f64;
    let (ux, uy) = (|x: u32| u(x as f64 * lib::SITE_W), |y: u32| u(y as f64 * t));
    let nets: Vec<&detail::DNet> = o.detail.nets.iter().filter(|n| !n.segs.is_empty() || !n.vias.is_empty()).collect();
    writeln!(s, "NETS {} ;", nets.len()).unwrap();
    for n in nets {
        let name = match n.bit { crate::netlist::Bit::W(w) => format!("n{}", w), _ => "const".into() };
        let mut conns = vec![];
        for (i, c) in o.mapped.cells.iter().enumerate() { for (p, b) in &c.conns { if *b == n.bit { conns.push(format!("( c{} {} )", i, p)); } } }
        for p in &pl.pins { if p.bit == n.bit { conns.push(format!("( PIN {} )", p.name)); } }
        let mut parts = vec![];
        for &(l, x0, y0, x1, y1) in &n.segs { parts.push(format!("{} ( {} {} ) ( {} {} )", detail::layer_name(l), ux(x0), uy(y0), ux(x1), uy(y1))); }
        for &(l, x, y) in &n.vias {
            let (layer, via) = if l == 255 { ("M1", "VIA12".to_string()) } else { (detail::layer_name(l), format!("VIA{}{}", l + 2, l + 3)) };
            parts.push(format!("{} ( {} {} ) {}", layer, ux(x), uy(y), via));
        }
        write!(s, "  - {} {}", name, conns.join(" ")).unwrap();
        if !parts.is_empty() { write!(s, "\n    + ROUTED {}", parts.join("\n      NEW ")).unwrap(); }
        writeln!(s, " ;").unwrap();
    }
    writeln!(s, "END NETS\nEND DESIGN").unwrap();
    s
}

/// net weights for timing-driven placement: only near-critical nets get
/// heavier, and less so the more loads they have (a heavy high-fanout net
/// would pull a whole region together and congest it)
pub fn timing_weights(nl: &Netlist, crit: &std::collections::HashMap<crate::netlist::Bit, f32>) -> std::collections::HashMap<crate::netlist::Bit, f64> {
    let mut fanout: std::collections::HashMap<crate::netlist::Bit, usize> = Default::default();
    for c in &nl.cells { for (p, b) in &c.conns { if !crate::netlist::is_out(p) { *fanout.entry(*b).or_default() += 1; } } }
    crit.iter().map(|(b, c)| (*b, 1.0 + 6.0 * (*c as f64).powi(8) / (fanout.get(b).copied().unwrap_or(1).max(1) as f64).sqrt())).collect()
}
