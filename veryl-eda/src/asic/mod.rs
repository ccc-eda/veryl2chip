//! ASIC back end on the "vlib" standard-cell library: technology mapping,
//! row placement, global routing and static timing.

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
}

pub fn flow(opt: &Netlist, seed: u64) -> Result<Output, String> {
    let t = |what: &str, t0: f64| if std::env::var("VERYL_EDA_PROFILE").is_ok() { eprintln!("{}: {:.2}s", what, now() - t0) };
    let t0 = now();
    let mapped = map::map(opt)?;
    t("map", t0);
    let t0 = now();
    let placement = place::place(&mapped, seed);
    t("place", t0);
    let t0 = now();
    let routing = route::route(&mapped, &placement);
    t("route", t0);
    let timing = sta::analyze(&mapped, &placement, &routing);
    let area = mapped.cells.iter().map(|c| lib::area(&c.typ)).sum();
    let mut m: std::collections::BTreeMap<String, usize> = Default::default();
    for c in &mapped.cells { *m.entry(c.typ.clone()).or_default() += 1; }
    let mut counts: Vec<(String, usize)> = m.into_iter().collect();
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(Output { mapped, placement, routing, timing, area, counts })
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
    writeln!(s, "END PINS\nEND DESIGN").unwrap();
    s
}
