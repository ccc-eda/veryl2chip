//! ASIC back end on the "vlib" standard-cell library: technology mapping,
//! row placement (wirelength, then timing-driven), clock tree synthesis,
//! global routing, static timing with a propagated clock, hold fixing.

pub mod antenna;
pub mod cts;
pub mod detail;
pub mod drc;
pub mod gds;
pub mod layout;
pub mod lib;
pub mod lvs;
pub mod spice;
pub mod map;
pub mod pdn;
pub mod power;
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
    /// diodes inserted for the antenna rules
    pub diodes: usize,
    pub detail: detail::Detail,
    pub pdn: pdn::Pdn,
    pub power: power::Power,
}

/// rounds of antenna fixing (each reroutes, which can bring new pieces over the limit)
const ANTENNA_ROUNDS: usize = 12;

pub fn flow(opt: &Netlist, seed: u64) -> Result<Output, String> { flow_with(opt, seed, 0.0) }

/// `extra_hold` (ns) is added to every hold requirement (tests use it to force hold fixing)
pub fn flow_with(opt: &Netlist, seed: u64, extra_hold: f64) -> Result<Output, String> {
    // (VERYL_EDA_ANTENNA_FIX=0 leaves the antenna violations, to look at them or compare checkers)
    flow_opts(opt, seed, extra_hold, std::env::var("VERYL_EDA_ANTENNA_FIX").map(|v| v != "0").unwrap_or(true))
}

/// `antenna_fix`: diodes for the antenna rules (a library technology with a diode cell)
pub fn flow_opts(opt: &Netlist, seed: u64, extra_hold: f64, antenna_fix: bool) -> Result<Output, String> {
    let t = |what: &str, t0: f64| if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("{}: {:.2}s", what, now() - t0) };
    let t0 = now();
    let mapped0 = map::map(opt)?;
    t("map", t0);
    // utilization: start at 65 %; a design whose global routing overflows or
    // fills its gcell edges more than half on average gets a bigger die (the
    // track-level router needs the room for pins and vias). A library technology
    // starts lower (its met1 / met3 / met4 carry fewer tracks) and, should the
    // detailed routing not come out clean, tries again on a bigger die.
    let lib_tech = !crate::pdk::tech().is_vlib();
    let mut util = if lib_tech { 0.55 } else { 0.65 };
    let mut attempt = 0;
    let (mut mapped, mut placement, mut routing, fmax_wl, fmax_ideal, cts, hold_bufs, mut pdn, mut detail) = loop {
        // (each new try also a new placement seed)
        let r = physical(&mapped0, seed + attempt as u64, util, extra_hold)?;
        attempt += 1;
        if !lib_tech || (r.8.conflicts == 0 && r.8.opens == 0) || attempt >= 4 || r.9 < 0.2 { break (r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8); }
        util = r.9 * 0.85;
    };
    // antenna rules (a library with a diode cell): a diode next to each gate whose piece of metal breaks
    // them, then the routing again; a fix that leaves the detailed routing worse is not kept
    let mut diodes = 0;
    if lib_tech && antenna_fix && crate::pdk::tech().binding("DIODE").is_some() {
        for _ in 0..ANTENNA_ROUNDS {
            let t0 = now();
            let l = layout::build_parts(&layout::Parts { mapped: &mapped, placement: &placement, pdn: &pdn, detail: &detail })?;
            let a = antenna::check(&l, &mapped);
            if a.violations.is_empty() { break; }
            if std::env::var("VERYL_EDA_PROFILE").is_ok() && a.violations.iter().any(|v| v.cell >= mapped.cells.len()) { eprintln!("  antenna: {} violations without a cell gate", a.violations.iter().filter(|v| v.cell >= mapped.cells.len()).count()); }
            let mut fixes: Vec<(usize, &'static str)> = a.violations.iter().filter(|v| v.cell < mapped.cells.len()).map(|v| (v.cell, v.lpin)).collect();
            fixes.sort();
            fixes.dedup();
            if std::env::var("VERYL_EDA_PROFILE").is_ok() {
                // gates that already have a diode on their net
                for &(c, p) in &fixes {
                    let b = mapped.cells[c].port(p);
                    let k = mapped.cells.iter().filter(|x| x.typ == "DIODE" && x.port("A") == b).count();
                    if k > 0 { let v = a.violations.iter().find(|v| v.cell == c).unwrap(); eprintln!("    again: c{}/{} on {} ({} diodes on its net; {} {:.0} > {:.0})", c, p, v.net, k, v.layer, v.ratio, v.limit); }
                }
            }
            // a routing made worse by the diodes: the same diodes on other sites (up to three places each)
            let mut avoid: Vec<(u32, u32)> = vec![];
            let mut done = None;
            for _ in 0..3 {
                let (mut m2, mut p2) = (mapped.clone(), placement.clone());
                let n = cts::add_diodes(&mut m2, &mut p2, &pdn.taps, &fixes, &avoid);
                if n == 0 { break; }
                let r2 = route::route(&m2, &p2);
                let pdn2 = pdn::build(&m2, &p2, &pdn.taps);
                let d2 = detail::route(&m2, &p2, &r2, &pdn2);
                if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("  antenna: {} violations, {} diodes; routing {} conflicts / {} opens (was {} / {})", a.violations.len(), n, d2.conflicts, d2.opens, detail.conflicts, detail.opens); }
                if d2.conflicts <= detail.conflicts && d2.opens <= detail.opens { done = Some((m2, p2, r2, pdn2, d2, n)); break; }
                avoid.extend(p2.pos[mapped.cells.len()..].iter().copied());
            }
            t("antenna diodes", t0);
            let Some((m2, p2, r2, pdn2, d2, n)) = done else { break };
            (mapped, placement, routing, pdn, detail) = (m2, p2, r2, pdn2, d2);
            diodes += n;
        }
    }
    let dlen: std::collections::HashMap<crate::netlist::Bit, f64> = detail.nets.iter().map(|n| (n.bit, n.length)).collect();
    for n in routing.nets.iter_mut() { if let Some(l) = dlen.get(&n.bit) { n.length = *l; } }
    let timing = sta::analyze(&mapped, &placement, &routing, extra_hold);
    // power at Fmax, from a random-input simulation of the final netlist
    let t0 = now();
    let cycles = (2_000_000 / mapped.cells.len().max(1)).clamp(100, 1000);
    let act = crate::power::activity(&mapped, cycles, 1);
    let power = power::estimate(&mapped, &placement, &dlen, &pdn, &act, timing.fmax);
    t("power", t0);
    let area = mapped.cells.iter().map(lib::cell_area).sum();
    let mut m: std::collections::BTreeMap<String, usize> = Default::default();
    for c in &mapped.cells { *m.entry(c.typ.clone()).or_default() += 1; }
    let mut counts: Vec<(String, usize)> = m.into_iter().collect();
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(Output { mapped, placement, routing, timing, area, counts, fmax_wl, fmax_ideal, cts, hold_bufs, diodes, detail, pdn, power })
}

/// placement, global routing, timing-driven refinement, clock tree, hold
/// fixing, taps and power grid, detailed routing at utilization `util`
#[allow(clippy::type_complexity)]
fn physical(mapped: &Netlist, seed: u64, util: f64, extra_hold: f64) -> Result<(Netlist, place::RowPlacement, route::Routing, f64, f64, cts::Cts, usize, pdn::Pdn, detail::Detail, f64), String> {
    let t = |what: &str, t0: f64| if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("{}: {:.2}s", what, now() - t0) };
    let t0 = now();
    let mut util = util;
    let mut mapped = mapped.clone();
    let (mut placement, mut routing);
    loop {
        placement = place::place(&mapped, seed, util, &Default::default(), None);
        t("place", t0);
        let t0 = now();
        // a short probe decides: a routable die needs few rounds
        let probe = route::route_with(&mapped, &placement, 8);
        if (probe.overflow > probe.iters[0] / 50 || probe.demand > 0.5) && util > 0.35 {
            if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("  probe: overflow {}, demand {:.2} at utilization {:.2}: bigger die", probe.overflow, probe.demand, util); }
            util *= 0.8;
            continue;
        }
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
    // power grid and fillers, then detailed routing around the straps
    let taps = pdn::insert_taps(&mapped, &mut placement);
    let pdn = pdn::build(&mapped, &placement, &taps);
    let detail = detail::route(&mapped, &placement, &routing, &pdn);
    t("detail route", t0);
    Ok((mapped, placement, routing, fmax_wl, fmax_ideal, cts, hold_bufs, pdn, detail, util))
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn now() -> f64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() }
#[cfg(target_arch = "wasm32")]
pub(crate) fn now() -> f64 { 0.0 }

/// the placement (and pins) as DEF, 1000 database units per µm, with the
/// current technology's cell, pin, site, layer and via names
pub fn def(o: &Output) -> String {
    use std::fmt::Write;
    let pl = &o.placement;
    let tech = crate::pdk::tech();
    let vlib = tech.is_vlib();
    let (sw, rh) = (lib::site_w(), lib::row_h());
    let u = |x: f64| (x * 1000.0).round() as i64;
    let orient = |r: u32| if r % 2 == 0 { "N" } else { "FS" };
    let mut s = String::new();
    writeln!(s, "VERSION 5.8 ;\nDIVIDERCHAR \"/\" ;\nBUSBITCHARS \"[]\" ;\nDESIGN {} ;\nUNITS DISTANCE MICRONS 1000 ;", o.mapped.name).unwrap();
    writeln!(s, "DIEAREA ( 0 0 ) ( {} {} ) ;", u(pl.w), u(pl.h)).unwrap();
    for r in 0..pl.rows {
        writeln!(s, "ROW ROW_{} {} 0 {} {} DO {} BY 1 STEP {} 0 ;", r, tech.site, u(r as f64 * rh), orient(r), pl.sites, u(sw)).unwrap();
    }
    // fillers: the library's filler cells (widest first) for each gap
    let mut fills: Vec<(u32, u32, String)> = vec![];
    for &(r, x, w) in &o.pdn.fillers {
        if vlib { fills.push((r, x, format!("FILL{}", w))); continue; }
        let (mut x, mut left) = (x, w);
        while left > 0 {
            let (fw, n) = tech.fillers.iter().find(|f| f.0 <= left).cloned().unwrap_or((left, format!("FILL{}", left)));
            fills.push((r, x, n));
            x += fw;
            left -= fw;
        }
    }
    let tap_name = tech.tap.as_ref().map(|t| t.0.clone()).unwrap_or_default();
    writeln!(s, "COMPONENTS {} ;", o.mapped.cells.len() + fills.len() + o.pdn.taps.len()).unwrap();
    for (i, c) in o.mapped.cells.iter().enumerate() {
        let (r, x) = pl.pos[i];
        writeln!(s, "  - c{} {} + PLACED ( {} {} ) {} ;", i, tech.cell_name(&c.typ), u(x as f64 * sw), u(r as f64 * rh), orient(r)).unwrap();
    }
    for (k, (r, x, n)) in fills.iter().enumerate() {
        writeln!(s, "  - fill{} {} + PLACED ( {} {} ) {} ;", k, n, u(*x as f64 * sw), u(*r as f64 * rh), orient(*r)).unwrap();
    }
    for (k, &(r, x)) in o.pdn.taps.iter().enumerate() {
        writeln!(s, "  - tap{} {} + PLACED ( {} {} ) {} ;", k, tap_name, u(x as f64 * sw), u(r as f64 * rh), orient(r)).unwrap();
    }
    writeln!(s, "END COMPONENTS\nPINS {} ;", pl.pins.len() + 2).unwrap();
    writeln!(s, "  - VDD + NET VDD + SPECIAL + DIRECTION INOUT + USE POWER ;\n  - VSS + NET VSS + SPECIAL + DIRECTION INOUT + USE GROUND ;").unwrap();
    // IO pins on the top grid layer, on their grid nodes
    let top = &tech.layers[3];
    let tk = rh / detail::TRACKS as f64;
    for p in &pl.pins {
        let (x, y) = if vlib { (p.x, p.y) } else { (p.x + tech.track_x0, p.y + tech.track_y0) };
        // the pin's shape relative to its position (a library technology: as in the GDS)
        let (x0, y0, x1, y1) = if vlib { (-200, -200, 200, 200) } else {
            let r = layout::pin_rect(u(x), u(y), u(pl.w), u(pl.h));
            (r.0 - u(x), r.1 - u(y), r.2 - u(x), r.3 - u(y))
        };
        writeln!(s, "  - {} + NET {} + DIRECTION {} + USE SIGNAL\n    + LAYER {} ( {} {} ) ( {} {} ) + PLACED ( {} {} ) N ;", p.name, p.name,
            if p.dir == crate::netlist::Dir::In { "INPUT" } else { "OUTPUT" }, top, x0, y0, x1, y1, u(x), u(y)).unwrap();
    }
    writeln!(s, "END PINS").unwrap();
    // power: rails on the row boundaries, straps on the top layer, via stacks
    writeln!(s, "SPECIALNETS 2 ;").unwrap();
    let (rail, rail_w) = if vlib { ("M1", 400) } else { ("met1", 480) };
    let strap_w = u(pdn::STRAP_W as f64 * sw - if vlib { 0.0 } else { 0.06 });
    let strap_x = |x: u32| if vlib { (x as f64 + 0.5) * sw } else { x as f64 * sw + tech.track_x0 + (pdn::STRAP_W as f64 - 1.0) * sw / 2.0 };
    for (net, vdd) in [("VDD", true), ("VSS", false)] {
        let mut parts = vec![];
        for r in 0..o.pdn.rails { if (r % 2 == 1) == vdd { parts.push(format!("{} {} ( 0 {} ) ( {} * )", rail, rail_w, u(r as f64 * rh), u(pl.w))); } }
        for &(x, sv) in &o.pdn.straps { if sv == vdd { parts.push(format!("{} {} ( {} 0 ) ( * {} )", top, strap_w, u(strap_x(x)), u(pl.h))); } }
        for &(x, y, sv) in &o.pdn.vias {
            if sv != vdd { continue; }
            if vlib { parts.push(format!("M1 0 ( {} {} ) VIA1_5", u(x as f64 * sw), u(y as f64 * tk))); continue; }
            // the stack from the rail up to the strap
            // the stack stands on the rail's centre line
            let (px, py) = (u(x as f64 * sw + tech.track_x0), u((y / detail::TRACKS) as f64 * rh));
            for l in 0..3 { parts.push(format!("{} 0 ( {} {} ) {}", tech.layers[l], px, py, tech.vias[l])); }
        }
        let conn = if vlib { format!("( * {} )", net) } else if vdd { "( * VPWR ) ( * VPB )".into() } else { "( * VGND ) ( * VNB )".into() };
        writeln!(s, "  - {} {}\n    + ROUTED {} ;", net, conn, parts.join("\n      NEW ")).unwrap();
    }
    writeln!(s, "END SPECIALNETS").unwrap();
    // detailed routes: wires per layer and vias; a pin via sits on the cell's
    // pin shape, joined to its grid node by a short stub on the first layer
    let (ux, uy) = (|x: u32| u(x as f64 * sw + tech.track_x0), |y: u32| u(y as f64 * tk + tech.track_y0));
    let mut stub: std::collections::HashMap<(u32, u32), f64> = Default::default();
    if !vlib {
        for (i, c) in o.mapped.cells.iter().enumerate() {
            let Some(b) = tech.binding(&c.typ) else { continue };
            for (k, (p, _)) in c.conns.iter().enumerate() {
                if let Some(a) = b.access.iter().find(|a| a.0 == *p) { stub.insert(detail::pin_point(&o.mapped, pl, i, k), a.3); }
            }
        }
    }
    let nets: Vec<&detail::DNet> = o.detail.nets.iter().filter(|n| !n.segs.is_empty() || !n.vias.is_empty()).collect();
    writeln!(s, "NETS {} ;", nets.len()).unwrap();
    // the cell pins and IO pins on each net
    let mut on_net: std::collections::HashMap<crate::netlist::Bit, Vec<String>> = Default::default();
    for (i, c) in o.mapped.cells.iter().enumerate() {
        let bind = tech.binding(&c.typ);
        for (p, b) in &c.conns { on_net.entry(*b).or_default().push(format!("( c{} {} )", i, bind.map(|x| x.lib_pin(p)).unwrap_or(p))); }
    }
    for p in &pl.pins { on_net.entry(p.bit).or_default().push(format!("( PIN {} )", p.name)); }
    for n in nets {
        let name = match n.bit { crate::netlist::Bit::W(w) => format!("n{}", w), _ => "const".into() };
        let conns = on_net.get(&n.bit).cloned().unwrap_or_default();
        let mut parts = vec![];
        for &(l, x0, y0, x1, y1) in &n.segs { parts.push(format!("{} ( {} {} ) ( {} {} )", tech.layers[l as usize], ux(x0), uy(y0), ux(x1), uy(y1))); }
        for &(l, x, y) in &n.vias {
            if l == 255 {
                let off = stub.get(&(x, y)).copied().unwrap_or(0.0);
                // a pin reached on its own met1: no pin via
                if off.is_nan() { continue; }
                let px = ux(x) + u(off);
                if px != ux(x) { parts.push(format!("{} ( {} {} ) ( {} {} )", tech.layers[0], ux(x), uy(y), px, uy(y))); }
                parts.push(format!("{} ( {} {} ) {}", tech.pin_layer, px, uy(y), tech.pin_via));
            } else {
                parts.push(format!("{} ( {} {} ) {}", tech.layers[l as usize], ux(x), uy(y), tech.vias[l as usize]));
            }
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
