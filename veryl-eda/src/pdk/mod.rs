//! Process design kits for the ASIC back end. The flow works on logical
//! cells (the vlib names INV, NAND2, AOI21, DFFR, ...); a `Tech` binds each
//! to a physical cell: its name and pin names in the library, its width in
//! placement sites, where its pins can be reached on the routing grid, and
//! (for a Liberty library) its timing. `vlib` is built in; SKY130 comes from
//! its Liberty and LEF files (`sky130_fd_sc_hd`).
//!
//! The flow reads the current technology from `tech()`; `with_tech` sets it
//! for one call (per thread, so parallel tests can use different ones).

pub mod def;
pub mod lef;
pub mod liberty;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// a logical cell bound to a library cell
#[derive(Debug, Clone)]
pub struct Binding {
    pub cell: String,
    /// (logical pin, library pin)
    pub pins: Vec<(&'static str, String)>,
    /// width in sites
    pub width: u32,
    /// pin access points: (logical pin, grid column from the cell's left edge, track inside the row,
    /// x offset (µm) of the pin via from that column: a short stub on layers[0] joins them)
    pub access: Vec<(&'static str, u32, u32, f64)>,
    pub area: f64,
}

impl Binding {
    pub fn lib_pin<'a>(&'a self, logical: &'a str) -> &'a str { self.pins.iter().find(|p| p.0 == logical).map(|p| p.1.as_str()).unwrap_or(logical) }
}

#[derive(Debug, Clone)]
pub struct Tech {
    pub name: String,
    pub row_h: f64,
    pub site_w: f64,
    pub site: String,
    /// physical position of routing-grid node (0, 0): track offsets (µm)
    pub track_x0: f64,
    pub track_y0: f64,
    /// routing tracks per row (the grid's y pitch is row_h / tracks)
    pub tracks: u32,
    /// the grid's four routing layers, bottom up, and the vias between them
    pub layers: [String; 4],
    pub vias: [String; 3],
    /// cell pin layer and the via from it to layers[0]
    pub pin_layer: String,
    pub pin_via: String,
    /// memories become SRAM macros (vlib) or stay flip-flops
    pub sram: bool,
    pub cells: HashMap<String, Binding>,
    /// filler cells by width in sites, widest first; the well tap cell and its maximum spacing (µm)
    pub fillers: Vec<(u32, String)>,
    pub tap: Option<(String, u32, f64)>,
    pub liberty: Option<liberty::Library>,
    pub lef: Option<lef::Lef>,
}

impl Tech {
    /// the Liberty cell bound to a logical cell
    pub fn lib_cell(&self, logical: &str) -> Option<&liberty::Cell> { self.liberty.as_ref()?.cell(&self.binding(logical)?.cell) }
    /// input capacitance (pF) of a logical pin
    pub fn pin_cap(&self, logical: &str, pin: &str) -> f64 {
        let Some(b) = self.binding(logical) else { return 0.0 };
        self.lib_cell(logical).and_then(|c| c.pin(b.lib_pin(pin))).map(|p| p.cap).unwrap_or(0.0)
    }
    /// delay and output slew (ns) of the arc from input `pin` to the output, at
    /// input slew `slew` (ns) and output load `load` (pF); the worse of rise and fall
    pub fn arc(&self, logical: &str, pin: &str, slew: f64, load: f64) -> Option<(f64, f64)> {
        let b = self.binding(logical)?;
        let c = self.lib_cell(logical)?;
        let from = b.lib_pin(pin);
        let mut best: Option<(f64, f64)> = None;
        for o in c.outputs() {
            for a in o.arcs.iter().filter(|a| a.related == from && !a.kind.starts_with("setup") && !a.kind.starts_with("hold") && !a.kind.starts_with("recovery") && !a.kind.starts_with("removal") && a.kind != "clear" && a.kind != "preset") {
                let d = [&a.cell_rise, &a.cell_fall].iter().filter_map(|t| t.as_ref().map(|t| t.at(slew, load))).fold(0.0, f64::max);
                let s = [&a.rise_transition, &a.fall_transition].iter().filter_map(|t| t.as_ref().map(|t| t.at(slew, load))).fold(0.0, f64::max);
                if best.map(|x| d > x.0) != Some(false) { best = Some((d, s)); }
            }
        }
        best
    }
    /// setup or hold requirement (ns) of data pin `pin` against the clock: the worse of rise and fall
    pub fn constraint(&self, logical: &str, pin: &str, setup: bool, clk_slew: f64, d_slew: f64) -> Option<f64> {
        let b = self.binding(logical)?;
        let p = self.lib_cell(logical)?.pin(b.lib_pin(pin))?;
        let want = if setup { "setup" } else { "hold" };
        p.arcs.iter().filter(|a| a.kind.starts_with(want)).flat_map(|a| [&a.rise_constraint, &a.fall_constraint]).filter_map(|t| t.as_ref().map(|t| t.at(clk_slew, d_slew))).reduce(f64::max)
    }
    /// wire resistance (Ω/µm) and capacitance (pF/µm) at minimum width, averaged over the routing layers
    pub fn wire_rc(&self) -> (f64, f64) {
        let Some(lef) = &self.lef else { return (0.0, 0.0) };
        let ls: Vec<&lef::Layer> = self.layers.iter().filter_map(|n| lef.layer(n)).collect();
        if ls.is_empty() { return (0.0, 0.0); }
        let r = ls.iter().map(|l| l.rpersq / l.width.max(1e-3)).sum::<f64>() / ls.len() as f64;
        let c = ls.iter().map(|l| l.cpersq * l.width + 2.0 * l.edgecap).sum::<f64>() / ls.len() as f64;
        (r, c)
    }
    pub fn binding(&self, logical: &str) -> Option<&Binding> { self.cells.get(logical) }
    pub fn is_vlib(&self) -> bool { self.name == "vlib" }
    /// the library cell name of a logical cell
    pub fn cell_name<'a>(&'a self, logical: &'a str) -> &'a str { self.cells.get(logical).map(|b| b.cell.as_str()).unwrap_or(logical) }
}

/// the built-in educational library (`asic::lib`): rows 4 µm, sites 0.5 µm, M1 pins, M2-M5 routing
pub fn vlib() -> Tech {
    use crate::asic::lib::{LIB, ROW_H, SITE_W};
    let cells = LIB.iter().map(|c| {
        let mut pins: Vec<(&'static str, String)> = c.ins.iter().map(|p| (*p, p.to_string())).collect();
        pins.push((if crate::asic::lib::is_ff(c.name) { "Q" } else { "Y" }, if crate::asic::lib::is_ff(c.name) { "Q".into() } else { "Y".into() }));
        (c.name.to_string(), Binding { cell: c.name.to_string(), pins, width: c.width, access: vec![], area: c.width as f64 * SITE_W * ROW_H })
    }).collect();
    Tech {
        name: "vlib".into(), row_h: ROW_H, site_w: SITE_W, site: "core".into(), track_x0: 0.0, track_y0: 0.0, tracks: 8,
        layers: ["M2".into(), "M3".into(), "M4".into(), "M5".into()], vias: ["VIA23".into(), "VIA34".into(), "VIA45".into()],
        pin_layer: "M1".into(), pin_via: "VIA12".into(), sram: true, cells,
        fillers: vec![], tap: None, liberty: None, lef: None,
    }
}

thread_local! {
    static CUR: RefCell<Option<Rc<Tech>>> = const { RefCell::new(None) };
    static VLIB: Rc<Tech> = Rc::new(vlib());
}

/// the technology of the running flow (vlib unless `with_tech` set another)
pub fn tech() -> Rc<Tech> { CUR.with(|c| c.borrow().clone()).unwrap_or_else(|| VLIB.with(|v| v.clone())) }

/// set this thread's technology (None: back to vlib)
pub fn set_tech(t: Option<Rc<Tech>>) { CUR.with(|c| *c.borrow_mut() = t); }

/// run `f` with `t` as the current technology
pub fn with_tech<R>(t: Rc<Tech>, f: impl FnOnce() -> R) -> R {
    let old = CUR.with(|c| c.replace(Some(t)));
    struct Restore(Option<Rc<Tech>>);
    impl Drop for Restore { fn drop(&mut self) { let o = self.0.take(); CUR.with(|c| *c.borrow_mut() = o); } }
    let _r = Restore(old);
    f()
}

// ---- SKY130 (sky130_fd_sc_hd) ----

pub enum Kind { Comb(&'static str), Ff { clk: &'static str, clear: Option<&'static str>, preset: Option<&'static str> } }

/// logical cell -> (library cell, (logical pin, library pin), function over the logical pins)
pub const SKY130_HD: &[(&str, &str, &[(&str, &str)], Kind)] = &[
    ("INV", "inv_1", &[("A", "A"), ("Y", "Y")], Kind::Comb("!A")),
    ("BUF", "buf_1", &[("A", "A"), ("Y", "X")], Kind::Comb("A")),
    ("CLKBUF", "clkbuf_2", &[("A", "A"), ("Y", "X")], Kind::Comb("A")),
    ("NAND2", "nand2_1", &[("A", "A"), ("B", "B"), ("Y", "Y")], Kind::Comb("!(A&B)")),
    ("NOR2", "nor2_1", &[("A", "A"), ("B", "B"), ("Y", "Y")], Kind::Comb("!(A|B)")),
    ("AND2", "and2_1", &[("A", "A"), ("B", "B"), ("Y", "X")], Kind::Comb("A&B")),
    ("OR2", "or2_1", &[("A", "A"), ("B", "B"), ("Y", "X")], Kind::Comb("A|B")),
    ("XOR2", "xor2_1", &[("A", "A"), ("B", "B"), ("Y", "X")], Kind::Comb("A^B")),
    ("XNOR2", "xnor2_1", &[("A", "A"), ("B", "B"), ("Y", "Y")], Kind::Comb("!(A^B)")),
    ("AOI21", "a21oi_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("Y", "Y")], Kind::Comb("!((A&B)|C)")),
    ("OAI21", "o21ai_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("Y", "Y")], Kind::Comb("!((A|B)&C)")),
    ("MUX2", "mux2_1", &[("A", "A0"), ("B", "A1"), ("S", "S"), ("Y", "X")], Kind::Comb("(S&B)|(!S&A)")),
    ("AO21", "a21o_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("Y", "X")], Kind::Comb("(A&B)|C")),
    ("OA21", "o21a_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("Y", "X")], Kind::Comb("(A|B)&C")),
    ("NAND3", "nand3_1", &[("A", "A"), ("B", "B"), ("C", "C"), ("Y", "Y")], Kind::Comb("!(A&B&C)")),
    ("NOR3", "nor3_1", &[("A", "A"), ("B", "B"), ("C", "C"), ("Y", "Y")], Kind::Comb("!(A|B|C)")),
    ("AND3", "and3_1", &[("A", "A"), ("B", "B"), ("C", "C"), ("Y", "X")], Kind::Comb("A&B&C")),
    ("OR3", "or3_1", &[("A", "A"), ("B", "B"), ("C", "C"), ("Y", "X")], Kind::Comb("A|B|C")),
    ("AOI22", "a22oi_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("D", "B2"), ("Y", "Y")], Kind::Comb("!((A&B)|(C&D))")),
    ("OAI22", "o22ai_1", &[("A", "A1"), ("B", "A2"), ("C", "B1"), ("D", "B2"), ("Y", "Y")], Kind::Comb("!((A|B)&(C|D))")),
    ("TIEL", "conb_1", &[("Y", "LO")], Kind::Comb("0")),
    ("TIEH", "conb_1", &[("Y", "HI")], Kind::Comb("1")),
    ("DFF", "dfxtp_1", &[("CK", "CLK"), ("D", "D"), ("Q", "Q")], Kind::Ff { clk: "CK", clear: None, preset: None }),
    ("DFFR", "dfrtp_1", &[("CK", "CLK"), ("D", "D"), ("RN", "RESET_B"), ("Q", "Q")], Kind::Ff { clk: "CK", clear: Some("!RN"), preset: None }),
    ("DFFS", "dfstp_1", &[("CK", "CLK"), ("D", "D"), ("SN", "SET_B"), ("Q", "Q")], Kind::Ff { clk: "CK", clear: None, preset: Some("!SN") }),
    ("DFFNR", "dfrtn_1", &[("CK", "CLK_N"), ("D", "D"), ("RN", "RESET_B"), ("Q", "Q")], Kind::Ff { clk: "!CK", clear: Some("!RN"), preset: None }),
];
pub const SKY130_PREFIX: &str = "sky130_fd_sc_hd__";

fn static_pin(p: &str) -> &'static str {
    ["A", "B", "C", "S", "Y", "Q", "D", "CK", "RN", "SN"].iter().find(|x| **x == p).copied().unwrap_or_else(|| Box::leak(p.to_string().into_boxed_str()))
}

/// check a library cell against the logical function: same truth table
/// (combinational) or the same flip-flop (clock edge, D, clear / preset)
pub fn check_binding(lc: &liberty::Cell, pins: &[(&str, &str)], kind: &Kind) -> Result<(), String> {
    let to_lib = |e: &str| -> Result<liberty::Expr, String> {
        // rename the logical pins to the library's in the logical function
        let mut x = liberty::function(e)?;
        fn ren(e: &mut liberty::Expr, m: &[(&str, &str)]) {
            match e {
                liberty::Expr::Var(v) => { if let Some(p) = m.iter().find(|p| p.0 == v) { *v = p.1.to_string(); } }
                liberty::Expr::Not(a) => ren(a, m),
                liberty::Expr::And(a, b) | liberty::Expr::Or(a, b) | liberty::Expr::Xor(a, b) => { ren(a, m); ren(b, m); }
                _ => {}
            }
        }
        ren(&mut x, pins);
        Ok(x)
    };
    let same = |a: &liberty::Expr, b: &liberty::Expr| {
        let mut vars = vec![];
        a.vars(&mut vars);
        b.vars(&mut vars);
        liberty::truth(a, &vars) == liberty::truth(b, &vars)
    };
    match kind {
        Kind::Comb(f) => {
            let out = pins.iter().find(|p| matches!(p.0, "Y")).ok_or("no output pin")?.1;
            let pf = lc.pin(out).and_then(|p| p.function.clone()).ok_or_else(|| format!("{}: pin {} has no function", lc.name, out))?;
            let have = liberty::function(&pf)?;
            if !same(&have, &to_lib(f)?) { return Err(format!("{}: {} = {}, expected {}", lc.name, out, pf, f)); }
        }
        Kind::Ff { clk, clear, preset } => {
            let ff = lc.ff.as_ref().ok_or_else(|| format!("{} is not a flip-flop", lc.name))?;
            let chk = |what: &str, have: &str, want: &str| -> Result<(), String> {
                if !same(&liberty::function(have)?, &to_lib(want)?) { return Err(format!("{}: {} = {}, expected {}", lc.name, what, have, want)); }
                Ok(())
            };
            chk("clocked_on", &ff.clocked_on, clk)?;
            chk("next_state", &ff.next_state, "D")?;
            match (clear, &ff.clear) { (Some(w), Some(h)) => chk("clear", h, w)?, (None, None) => {}, _ => return Err(format!("{}: clear differs", lc.name)) }
            match (preset, &ff.preset) { (Some(w), Some(h)) => chk("preset", h, w)?, (None, None) => {}, _ => return Err(format!("{}: preset differs", lc.name)) }
            // the output follows the state
            let q = pins.iter().find(|p| p.0 == "Q").ok_or("no Q")?.1;
            let qf = lc.pin(q).and_then(|p| p.function.clone()).unwrap_or_default();
            if qf.trim() != ff.state.0 { return Err(format!("{}: {} = {}, expected {}", lc.name, q, qf, ff.state.0)); }
        }
    }
    Ok(())
}

/// pin access points of a cell from its LEF pin shapes on `layer`: a grid
/// node (site-centre column, inner routing track: not the two under the
/// power rails) and the nearest point of the shape on that track, at most
/// half a column away (with `margin` inside the shape); every pin gets a
/// different node, the shortest stub first
pub fn access_points(m: &lef::Macro, pins: &[(&'static str, String)], layer: &str, site_w: f64, track_x0: f64, row_h: f64, tracks: u32, track_y0: f64, margin: f64) -> Result<Vec<(&'static str, u32, u32, f64)>, String> {
    let pitch_y = row_h / tracks as f64;
    let width = (m.w / site_w).round() as u32;
    // keep-outs (cell coordinates): the cell's own met1 and contacts the pin via and its stub must clear
    let met1: Vec<&lef::Rect> = m.obs.iter().filter(|q| q.layer == "met1").collect();
    // (the pins' own contacts too: a set / reset pin brings its own met1 and contact)
    let mcon: Vec<&lef::Rect> = m.obs.iter().chain(m.pins.iter().flat_map(|q| q.shapes.iter())).filter(|q| q.layer == "mcon").collect();
    let hits = |rs: &[&lef::Rect], x0: f64, y0: f64, x1: f64, y1: f64| rs.iter().any(|q| x0 < q.x1 && q.x0 < x1 && y0 < q.y1 && q.y0 < y1);
    // (column, track, via x) of the pins done
    let mut used: Vec<(u32, u32, f64)> = vec![];
    let mut out = vec![];
    for (lp, pp) in pins {
        let pin = m.pin(pp).ok_or_else(|| format!("{}: no pin {} in the LEF", m.name, pp))?;
        let mut cands: Vec<(f64, u32, u32, f64)> = vec![];
        // a pin with its own met1 (set / reset) is reached on that met1, at a node inside it (offset NaN: no pin via)
        let on_met1 = pin.shapes.iter().any(|r| r.layer == "met1");
        if on_met1 {
            for r in pin.shapes.iter().filter(|r| r.layer == "met1") {
                for dx in 0..width {
                    let x = track_x0 + dx as f64 * site_w;
                    if x < r.x0 || x > r.x1 { continue; }
                    for ty in 1..tracks - 1 {
                        let y = track_y0 + ty as f64 * pitch_y;
                        if y < r.y0 || y > r.y1 { continue; }
                        cands.push(((y - (r.y0 + r.y1) / 2.0).abs(), dx, ty, f64::NAN));
                    }
                }
            }
        }
        for r in pin.shapes.iter().filter(|r| r.layer == layer && !on_met1) {
            if r.x1 - r.x0 < 2.0 * margin - 1e-6 { continue; }
            for dx in 0..width {
                let x = track_x0 + dx as f64 * site_w;
                let px = x.clamp(r.x0 + margin, r.x1 - margin);
                if (px - x).abs() > site_w / 2.0 + 1e-6 { continue; }
                for ty in 1..tracks - 1 {
                    let y = track_y0 + ty as f64 * pitch_y;
                    if y < r.y0 + margin - 1e-6 || y > r.y1 - margin + 1e-6 { continue; }
                    cands.push(((px - x).abs() * 4.0 + (y - (r.y0 + r.y1) / 2.0).abs(), dx, ty, px - x));
                }
            }
        }
        cands.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        // the other pins' met1 shapes are keep-outs as well
        let other_met1: Vec<&lef::Rect> = m.pins.iter().filter(|q| q.name != *pp && q.usage != "POWER" && q.usage != "GROUND").flat_map(|q| q.shapes.iter()).filter(|q| q.layer == "met1").collect();
        let keep: Vec<&lef::Rect> = met1.iter().copied().chain(other_met1).collect();
        // clear of them: the via's met1 pad, the stub and the met1-met2 via pad at the node (+ met1 spacing),
        // its contact (+ contact spacing), and far enough from the cell's edges that a neighbour's contact is too
        let clear = |c: &(f64, u32, u32, f64)| {
            let x = track_x0 + c.1 as f64 * site_w;
            let y = track_y0 + c.2 as f64 * pitch_y;
            // on the pin's met1: only the met1-met2 via pad must clear the rest
            if c.3.is_nan() { return !hits(&keep, x - 0.16 - 0.14, y - 0.13 - 0.14, x + 0.16 + 0.14, y + 0.13 + 0.14); }
            let px = x + c.3;
            px >= 0.18 && px <= m.w - 0.18
                && !hits(&keep, x.min(px) - 0.16 - 0.14, y - 0.13 - 0.14, x.max(px) + 0.16 + 0.14, y + 0.13 + 0.14)
                && !hits(&mcon, px - 0.085 - 0.19, y - 0.085 - 0.19, px + 0.085 + 0.19, y + 0.085 + 0.19)
        };
        // a node of its own, not right above / below another pin's, and its contact clear of the others'
        let free = |c: &&(f64, u32, u32, f64)| !used.iter().any(|u| (u.0 == c.1 && u.1.abs_diff(c.2) <= 1)
            || (u.1 == c.2 && !c.3.is_nan() && !u.2.is_nan() && (u.2 - (track_x0 + c.1 as f64 * site_w + c.3)).abs() < 0.36));
        // a different node, and not right above / below another pin's (their via pads would be too close)
        let Some(&(_, dx, ty, off)) = cands.iter().filter(|c| clear(c)).find(free).or_else(|| cands.iter().find(free)) else {
            return Err(format!("{}: no access point for pin {}", m.name, pp));
        };
        used.push((dx, ty, track_x0 + dx as f64 * site_w + off));
        out.push((*lp, dx, ty, if off.is_nan() { off } else { (off * 1000.0).round() / 1000.0 }));
    }
    Ok(out)
}

/// SKY130 from its Liberty library and LEF (tech + cells)
pub fn sky130(lib: liberty::Library, lef: lef::Lef) -> Result<Tech, String> {
    let site = lef.site("unithd").ok_or("no SITE unithd in the LEF")?.clone();
    let met1 = lef.layer("met1").ok_or("no met1")?.clone();
    let met2 = lef.layer("met2").ok_or("no met2")?.clone();
    let tracks = (site.h / met1.pitch.1.max(met1.pitch.0)).round() as u32;
    let (tx0, ty0) = (met2.offset.0, met1.offset.1.max(met1.offset.0));
    let mut cells = HashMap::new();
    for (logical, name, pins, kind) in SKY130_HD {
        let full = format!("{}{}", SKY130_PREFIX, name);
        let lc = lib.cell(&full).ok_or_else(|| format!("{} is not in the Liberty file", full))?;
        check_binding(lc, pins, kind)?;
        let m = lef.macro_(&full).ok_or_else(|| format!("{} is not in the LEF", full))?;
        let pins: Vec<(&'static str, String)> = pins.iter().map(|(l, p)| (static_pin(l), p.to_string())).collect();
        let access = access_points(m, &pins, "li1", site.w, site.w / 2.0, site.h, tracks, ty0, 0.085)?;
        cells.insert(logical.to_string(), Binding { cell: full.clone(), pins, width: (m.w / site.w).round() as u32, access, area: lc.area });
    }
    // stronger versions of the logic cells (_2, _4) where the library has them: "NAND2@2", "NAND2@4"
    // (the timing repair swaps them in on critical paths)
    for (logical, name, pins, kind) in SKY130_HD {
        let Kind::Comb(_) = kind else { continue };
        if !name.ends_with("_1") || matches!(*logical, "TIEL" | "TIEH" | "CLKBUF") { continue; }
        for s in [2, 4] {
            let full = format!("{}{}_{}", SKY130_PREFIX, &name[..name.len() - 2], s);
            let (Some(lc), Some(m)) = (lib.cell(&full), lef.macro_(&full)) else { continue };
            check_binding(lc, pins, kind)?;
            let pins: Vec<(&'static str, String)> = pins.iter().map(|(l, p)| (static_pin(l), p.to_string())).collect();
            let Ok(access) = access_points(m, &pins, "li1", site.w, site.w / 2.0, site.h, tracks, ty0, 0.085) else { continue };
            cells.insert(format!("{}@{}", logical, s), Binding { cell: full.clone(), pins, width: (m.w / site.w).round() as u32, access, area: lc.area });
        }
    }
    // the antenna diode (no function to check): only when the library has it
    let diode = format!("{}diode_2", SKY130_PREFIX);
    if let (Some(lc), Some(m)) = (lib.cell(&diode), lef.macro_(&diode)) {
        let pins: Vec<(&'static str, String)> = vec![("A", "DIODE".into())];
        let access = access_points(m, &pins, "li1", site.w, site.w / 2.0, site.h, tracks, ty0, 0.085)?;
        cells.insert("DIODE".to_string(), Binding { cell: diode.clone(), pins, width: (m.w / site.w).round() as u32, access, area: lc.area });
    }
    let fillers = [8u32, 4, 2, 1].iter().filter_map(|w| { let n = format!("{}fill_{}", SKY130_PREFIX, w); lef.macro_(&n).map(|_| (*w, n)) }).collect();
    let tap = lef.macro_(&format!("{}tapvpwrvgnd_1", SKY130_PREFIX)).map(|m| (m.name.clone(), (m.w / site.w).round() as u32, 14.0));
    Ok(Tech {
        name: "sky130_fd_sc_hd".into(), row_h: site.h, site_w: site.w, site: site.name.clone(), track_x0: tx0, track_y0: ty0, tracks,
        layers: ["met1".into(), "met2".into(), "met3".into(), "met4".into()], vias: ["M1M2_PR".into(), "M2M3_PR".into(), "M3M4_PR".into()],
        pin_layer: "li1".into(), pin_via: "L1M1_PR".into(), sram: false, cells, fillers, tap,
        liberty: Some(lib), lef: Some(lef),
    })
}

/// the built-in SKY130 subset (`pdk/sky130hd/`), parsed once per thread
pub fn sky130_builtin() -> Result<Rc<Tech>, String> {
    thread_local! { static T: RefCell<Option<Rc<Tech>>> = const { RefCell::new(None) }; }
    if let Some(t) = T.with(|t| t.borrow().clone()) { return Ok(t); }
    let lib = liberty::library(&liberty::parse(include_str!("../../pdk/sky130hd/sky130_fd_sc_hd__tt_025C_1v80.lib"))?);
    let mut lef = lef::parse(include_str!("../../pdk/sky130hd/sky130_fd_sc_hd.tlef"))?;
    lef.merge(lef::parse(include_str!("../../pdk/sky130hd/sky130_fd_sc_hd.lef"))?);
    let t = Rc::new(sky130(lib, lef)?);
    T.with(|c| *c.borrow_mut() = Some(t.clone()));
    Ok(t)
}

/// the cells' GDS structures of the built-in subset
pub const SKY130_GDS: &[u8] = include_bytes!("../../pdk/sky130hd/sky130_fd_sc_hd.gds");

/// a technology by name: "vlib", "sky130" (the built-in subset) or "sky130:DIR" (the full files in DIR)
pub fn by_name(n: &str) -> Result<Rc<Tech>, String> {
    match n {
        "vlib" => Ok(VLIB.with(|v| v.clone())),
        "sky130" | "sky130hd" | "sky130_fd_sc_hd" => sky130_builtin(),
        #[cfg(not(target_arch = "wasm32"))]
        n if n.starts_with("sky130:") => sky130_from_dir(std::path::Path::new(&n[7..])).map(Rc::new),
        n => Err(format!("unknown PDK '{}' (vlib, sky130)", n)),
    }
}

/// a mapped netlist with the library's cell and pin names (for Verilog / DEF output)
pub fn to_library(nl: &crate::netlist::Netlist) -> crate::netlist::Netlist {
    let t = tech();
    let mut out = nl.clone();
    if t.is_vlib() { return out; }
    for c in out.cells.iter_mut() {
        let Some(b) = t.binding(&c.typ) else { continue };
        for (p, _) in c.conns.iter_mut() { *p = static_pin(b.lib_pin(p)); }
        c.typ = b.cell.clone();
    }
    out
}

/// Verilog models of the bound library cells, from their Liberty functions
/// (for simulating the exported netlist, e.g. with iverilog)
pub fn verilog_models() -> String {
    let t = tech();
    if t.is_vlib() { return crate::asic::lib::verilog_models(); }
    let Some(lib) = t.liberty.as_ref() else { return String::new() };
    let mut names: Vec<&String> = t.cells.values().map(|b| &b.cell).collect();
    names.sort();
    names.dedup();
    let mut s = format!("// {} cells (veryl-eda), behavioural models from the Liberty functions\n", t.name);
    for n in names {
        let Some(c) = lib.cell(n) else { continue };
        let mut ports: Vec<String> = c.inputs().map(|p| format!("input {}", p.name)).collect();
        let reg = c.ff.is_some();
        ports.extend(c.outputs().map(|p| format!("output {}{}", if reg && p.function.as_deref().map(|f| f.trim()) == c.ff.as_ref().map(|f| f.state.0.as_str()) { "reg " } else { "" }, p.name)));
        s += &format!("module {} ({});\n", n, ports.join(", "));
        if let Some(ff) = &c.ff {
            let edge = |e: &str| -> Option<(String, String)> {
                // "X" -> (posedge X, X); "!X" -> (negedge X, !X)
                match liberty::function(e).ok()? {
                    liberty::Expr::Var(v) => Some((format!("posedge {}", v), v)),
                    liberty::Expr::Not(a) => if let liberty::Expr::Var(v) = *a { Some((format!("negedge {}", v), format!("!{}", v))) } else { None },
                    _ => None,
                }
            };
            let q = c.outputs().find(|p| p.function.as_deref().map(|f| f.trim()) == Some(ff.state.0.as_str())).map(|p| p.name.clone()).unwrap_or("Q".into());
            let (ck, _) = edge(&ff.clocked_on).unwrap_or(("posedge CLK".into(), String::new()));
            let mut sens = vec![ck];
            let mut body = String::new();
            if let Some((e, cond)) = ff.clear.as_deref().and_then(edge) { sens.push(e); body += &format!("if ({}) {} <= 1'b0; else ", cond, q); }
            if let Some((e, cond)) = ff.preset.as_deref().and_then(edge) { sens.push(e); body += &format!("if ({}) {} <= 1'b1; else ", cond, q); }
            let d = liberty::function(&ff.next_state).map(|e| e.verilog()).unwrap_or("D".into());
            s += &format!("  initial {} = 1'b0;\n  always @({}) {}{} <= {};\n", q, sens.join(" or "), body, q, d);
            for o in c.outputs().filter(|p| p.name != q) {
                if let Some(f) = &o.function { if f.trim() == ff.state.1 { s += &format!("  assign {} = ~{};\n", o.name, q); } }
            }
        } else {
            for o in c.outputs() {
                if let Some(f) = o.function.as_deref().and_then(|f| liberty::function(f).ok()) { s += &format!("  assign {} = {};\n", o.name, f.verilog()); }
            }
        }
        s += "endmodule\n";
    }
    s
}

/// where the full SKY130 files are (VERYL_EDA_SKY130, else /Users/Shared/ccc/sky130hd, ~/sky130hd)
pub fn sky130_dir() -> Option<std::path::PathBuf> {
    let mut c: Vec<std::path::PathBuf> = vec![];
    if let Ok(d) = std::env::var("VERYL_EDA_SKY130") { c.push(d.into()); }
    c.push("/Users/Shared/ccc/sky130hd".into());
    if let Ok(h) = std::env::var("HOME") { c.push(std::path::Path::new(&h).join("sky130hd")); }
    c.into_iter().find(|d| d.join("sky130_fd_sc_hd.tlef").exists())
}

/// read the full SKY130 files from a directory
#[cfg(not(target_arch = "wasm32"))]
pub fn sky130_from_dir(d: &std::path::Path) -> Result<Tech, String> {
    let rd = |f: &str| std::fs::read_to_string(d.join(f)).map_err(|e| format!("{}: {}", f, e));
    let lib = liberty::library(&liberty::parse(&rd("sky130_fd_sc_hd__tt_025C_1v80.lib")?)?);
    let mut lef = lef::parse(&rd("sky130_fd_sc_hd.tlef")?)?;
    lef.merge(lef::parse(&rd("sky130_fd_sc_hd_merged.lef")?)?);
    sky130(lib, lef)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liberty_functions() {
        let e = liberty::function("!((A1&A2) | B1)").unwrap();
        let v: Vec<String> = ["A1", "A2", "B1"].iter().map(|s| s.to_string()).collect();
        assert_eq!(liberty::truth(&e, &v), 0b0111);
        let e2 = liberty::function("(A1 A2 + B1)'").unwrap();
        assert_eq!(liberty::truth(&e2, &v), 0b0111);
        let t = liberty::Table { index_1: vec![0.0, 1.0], index_2: vec![0.0, 2.0], values: vec![vec![1.0, 3.0], vec![2.0, 6.0]], transposed: false };
        assert!((t.at(0.5, 1.0) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn sky130_builtin_subset() {
        let t = sky130_builtin().unwrap();
        // the table's cells, their stronger versions and the antenna diode
        assert!(t.cells.len() > SKY130_HD.len() + 20, "{} bindings", t.cells.len());
        assert_eq!(t.binding("NAND2@2").map(|b| b.cell.as_str()), Some("sky130_fd_sc_hd__nand2_2"));
        assert_eq!(t.binding("INV@4").map(|b| b.cell.as_str()), Some("sky130_fd_sc_hd__inv_4"));
        assert_eq!(t.binding("DIODE").map(|b| b.cell.as_str()), Some("sky130_fd_sc_hd__diode_2"));
        let m = with_tech(t, verilog_models);
        assert!(m.contains("module sky130_fd_sc_hd__dfrtp_1 (input CLK, input D, input RESET_B, output reg Q);"), "{}", m);
        assert!(m.contains("always @(posedge CLK or negedge RESET_B) if (!RESET_B) Q <= 1'b0; else Q <= D;"));
        assert!(m.contains("always @(negedge CLK_N or negedge RESET_B)"));
    }

    /// the full SKY130 hd library (skipped when the files are not there)
    #[test]
    fn sky130_full_library() {
        let Some(d) = sky130_dir() else { eprintln!("sky130 files not found: skipped"); return };
        let t = sky130_from_dir(&d).unwrap();
        let lib = t.liberty.as_ref().unwrap();
        let lef = t.lef.as_ref().unwrap();
        assert!(lib.cells.len() > 400, "{} cells", lib.cells.len());
        assert!(lef.macros.len() > 400);
        assert_eq!((t.row_h, t.site_w, t.tracks), (2.72, 0.46, 8));
        let inv = lib.cell("sky130_fd_sc_hd__inv_1").unwrap();
        let arc = &inv.pin("Y").unwrap().arcs[0];
        // cell_fall at (0.01 ns, 0.0005 pF) is the table's first entry
        assert!((arc.cell_fall.as_ref().unwrap().at(0.01, 0.0005) - 0.0143656).abs() < 1e-9);
        assert_eq!(t.binding("AOI21").unwrap().cell, "sky130_fd_sc_hd__a21oi_1");
        for b in t.cells.values() { assert_eq!(b.access.len(), b.pins.len(), "{}", b.cell); }
        let m1 = lef.layer("met1").unwrap();
        assert!(m1.horizontal && (m1.pitch.1 - 0.34).abs() < 1e-9 && m1.rpersq > 0.0);
        let v = lef.via("M1M2_PR").unwrap();
        assert_eq!(v.rects.iter().map(|r| r.layer.as_str()).collect::<Vec<_>>(), ["via", "met1", "met2"]);
    }
}
