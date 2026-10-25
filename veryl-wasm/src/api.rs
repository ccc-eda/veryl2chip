//! The requests the web front end can make.

use serde_json::{json, Value};
use std::cell::RefCell;
use veryl_eda::netlist::{Bit, Dir, Netlist};
use veryl_eda::pnr::chipdb::{Chip, Kind};

thread_local! {
    static CHIP: RefCell<Option<Chip>> = const { RefCell::new(None) };
}

pub fn set_chip(c: Chip) { CHIP.with(|x| *x.borrow_mut() = Some(c)); }

type R<T> = Result<T, String>;

fn bit(b: &Bit) -> Value {
    match b { Bit::C0 => json!("0"), Bit::C1 => json!("1"), Bit::W(w) => json!(w) }
}

fn dir(d: Dir) -> &'static str { if d == Dir::In { "in" } else { "out" } }

/// netlist as JSON: cells are {t: type, c: [[pin, bit]..], p: {param: value}}
pub fn netlist_json(nl: &Netlist) -> Value {
    json!({
        "ports": nl.ports.iter().map(|p| json!({ "name": p.name, "dir": dir(p.dir), "bits": p.bits.iter().map(bit).collect::<Vec<_>>() })).collect::<Vec<_>>(),
        "cells": nl.cells.iter().map(|c| {
            let mut o = json!({ "t": c.typ, "c": c.conns.iter().map(|(p, b)| json!([p, bit(b)])).collect::<Vec<_>>() });
            if !c.params.is_empty() { o["p"] = c.params.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>().into(); }
            o
        }).collect::<Vec<_>>(),
        "nets": nl.nets.iter().map(|(n, b)| json!({ "name": n, "bits": b.iter().map(bit).collect::<Vec<_>>() })).collect::<Vec<_>>(),
    })
}

fn kind_name(k: Kind) -> &'static str {
    match k {
        Kind::Local => "local", Kind::LutIn => "in", Kind::LutOut => "out", Kind::Ctrl => "ctrl", Kind::Glb => "glb",
        Kind::Glb2Local => "g2l", Kind::Sp4H | Kind::Sp4V => "sp4", Kind::Sp12H | Kind::Sp12V => "sp12", Kind::Io => "io",
        Kind::Carry => "carry", Kind::Fabout => "fabout", Kind::Other => "other",
    }
}

/// readable wire names: declared nets first, then ports (the first name wins)
fn net_names(nls: &[&Netlist]) -> std::collections::HashMap<Bit, String> {
    let mut m = std::collections::HashMap::new();
    let idx = |n: &str, i: usize, len: usize| if len > 1 { format!("{}[{}]", n, i) } else { n.to_string() };
    for nl in nls { for (n, bits) in &nl.nets { for (i, b) in bits.iter().enumerate() { m.entry(*b).or_insert_with(|| idx(n, i, bits.len())); } } }
    for nl in nls { for p in &nl.ports { for (i, b) in p.bits.iter().enumerate() { m.entry(*b).or_insert_with(|| idx(&p.name, i, p.bits.len())); } } }
    m
}

/// the ASIC flow on the vlib standard cells
fn asic(v: &Value) -> R<Value> {
    use veryl_eda::asic;
    let (top, (st, _)) = synth_netlists(v)?;
    let seed = v.get("seed").and_then(|s| s.as_u64()).unwrap_or(1);
    let o = asic::flow(&st.opt, seed)?;
    let (pl, rt, tm) = (&o.placement, &o.routing, &o.timing);
    let n = o.mapped.cells.len();
    let crit: std::collections::HashSet<usize> = tm.crit_cells.iter().copied().collect();
    let names = net_names(&[&o.mapped, &st.opt]);
    let crit_nets: std::collections::HashSet<Bit> = tm.crit_nets.iter().copied().collect();
    // at most 30 annealing frames (big designs: 20)
    let maxf = if n > 3000 { 20 } else { 30 };
    let hl = pl.history.len();
    let frames: Vec<usize> = if hl <= maxf { (0..hl).collect() } else { (0..maxf).map(|i| i * (hl - 1) / (maxf - 1)).collect() };
    let mut verilog = veryl_eda::output::to_verilog(&o.mapped);
    verilog += &asic::lib::verilog_models();
    Ok(json!({
        "ok": true,
        "top": top,
        "map": netlist_json(&o.mapped),
        "lib": asic::lib::LIB.iter().map(|c| json!({ "name": c.name, "ins": c.ins, "width": c.width, "delay": c.delay, "load": c.load, "setup": c.setup, "area": asic::lib::area(c.name), "verilog": c.verilog })).collect::<Vec<_>>(),
        "counts": o.counts,
        "area": o.area,
        "die": { "w": pl.w, "h": pl.h, "rows": pl.rows, "sites": pl.sites, "util": pl.util, "row_h": asic::lib::ROW_H, "site_w": asic::lib::SITE_W },
        "cells": o.mapped.cells.iter().enumerate().map(|(i, c)| { let (w, h) = asic::lib::dims(c); json!([pl.pos[i].0, pl.pos[i].1, w, (tm.arrival[i] * 1000.0).round() / 1000.0, crit.contains(&i) as u8, h]) }).collect::<Vec<_>>(),
        "pins": pl.pins.iter().map(|p| json!({ "name": p.name, "dir": dir(p.dir), "x": p.x, "y": p.y })).collect::<Vec<_>>(),
        "history": frames.iter().map(|&k| { let f = &pl.history[k]; json!({ "temp": f.temp, "cost": f.cost, "accept": f.accept, "pos": f.pos.iter().flat_map(|p| [p.0, p.1]).collect::<Vec<_>>() }) }).collect::<Vec<_>>(),
        "route": {
            "gx": rt.gx, "gy": rt.gy, "cap": asic::route::CAP, "iters": rt.iters, "wirelength": rt.wirelength, "vias": rt.vias, "overflow": rt.overflow,
            "nets": rt.nets.iter().map(|r| json!({
                "name": names.get(&r.bit).cloned().unwrap_or_else(|| match r.bit { Bit::W(w) => format!("n{}", w), _ => "const".into() }), "clock": r.clock, "len": r.length, "vias": r.vias, "crit": crit_nets.contains(&r.bit),
                "segs": r.segs.iter().flat_map(|s| [s.0, s.1, s.2, s.3]).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        },
        "timing": { "period": tm.period, "fmax": tm.fmax, "fmax_wl": o.fmax_wl, "endpoints": tm.endpoints, "path": tm.path.iter().map(|s| json!({ "what": s.what, "delay": s.delay, "at": s.at })).collect::<Vec<_>>() },
        "verilog": verilog,
        "def": asic::def(&o),
    }))
}

fn pnr(v: &Value) -> R<Value> {
    let (top, lib_out) = synth_netlists(v)?;
    let (st, mapped) = lib_out;
    let pcf = v.get("pcf").and_then(|p| p.as_str()).map(veryl_eda::pnr::parse_pcf).unwrap_or_default();
    let seed = v.get("seed").and_then(|s| s.as_u64()).unwrap_or(1);
    CHIP.with(|c| -> R<Value> {
        let cb = c.borrow();
        let chip = cb.as_ref().ok_or("chip database not loaded")?;
        let timing_driven = v.get("timing_driven").and_then(|t| t.as_bool()).unwrap_or(true);
        let opts = veryl_eda::pnr::Opts { chipdb: None, package: "sg48".into(), pcf, seed, verbose: false, timing_driven };
        let out = veryl_eda::pnr::place_and_route_on(chip, &mapped, &opts)?;
        let names = |b: Option<Bit>| -> String {
            match b {
                None => String::new(),
                Some(b) => mapped.nets.iter().chain(st.opt.nets.iter()).find_map(|(n, bits)| bits.iter().position(|x| *x == b).map(|i| if bits.len() > 1 { format!("{}[{}]", n, i) } else { n.clone() }))
                    .or_else(|| mapped.ports.iter().find_map(|p| p.bits.iter().position(|x| *x == b).map(|i| if p.bits.len() > 1 { format!("{}[{}]", p.name, i) } else { p.name.clone() })))
                    .unwrap_or_else(|| match b { Bit::W(w) => format!("n{}", w), Bit::C0 => "0".into(), Bit::C1 => "1".into() }),
            }
        };
        let is_extra = |pp: u32| pp >= u32::MAX - out.extra as u32;
        // device grid
        let tiles: Vec<Value> = chip.tiles.iter().map(|((x, y), t)| json!([x, y, t])).collect();
        let lcs: Vec<Value> = out.packed.lcs.iter().enumerate().map(|(i, lc)| {
            let (x, y, z) = out.placement.lc[i];
            json!({
                "x": x, "y": y, "z": z,
                "init": format!("{:04x}", lc.init),
                "carry": lc.carry, "in3c": lc.in3_chain,
                "ff": lc.ff.as_ref().map(|f| json!({ "neg": f.neg, "sr": f.sr.is_some(), "set": f.set, "async": f.asynch })),
                "out": names(lc.out),
                "ins": lc.ins.iter().map(|b| names(*b)).collect::<Vec<_>>(),
                "arr": out.timing.lc_arrival.get(i).copied().unwrap_or(0.0),
            })
        }).collect();
        let ios: Vec<Value> = out.packed.ios.iter().enumerate().map(|(i, io)| {
            let (x, y, z, pin) = &out.placement.io[i];
            json!({ "name": io.name, "dir": dir(io.dir), "x": x, "y": y, "z": z, "pin": pin })
        }).collect();
        let history: Vec<Value> = out.placement.history.iter().map(|f| json!({
            "temp": f.temp, "cost": f.cost, "accept": f.accept,
            "pos": f.lc.iter().flat_map(|(x, y, z)| [*x, *y, *z as i32]).collect::<Vec<_>>(),
            "ram": f.ram.iter().flat_map(|(x, y)| [*x, *y]).collect::<Vec<_>>(),
        })).collect();
        let rams: Vec<Value> = out.packed.rams.iter().enumerate().map(|(i, r)| {
            let (x, y) = out.placement.ram[i];
            let mode = |m: u8| ["256×16", "512×8", "1024×4", "2048×2"][m as usize & 3];
            json!({ "x": x, "y": y, "read": mode(r.read_mode), "write": mode(r.write_mode),
                "ins": r.ins.iter().map(|(p, b)| json!([p, names(Some(*b))])).collect::<Vec<_>>(),
                "outs": r.outs.iter().map(|(p, b)| json!([p, names(Some(*b))])).collect::<Vec<_>>() })
        }).collect();
        // route trees as tile-to-tile segments: from the tile of the pip that
        // drove a wire to the tile of the pip it drives
        let crit: std::collections::HashSet<u32> = out.timing.crit_pips.iter().copied().collect();
        let nets: Vec<Value> = out.nets.iter().enumerate().map(|(ni, net)| {
            let mut tile_of_wire: std::collections::HashMap<u32, (i32, i32)> = std::collections::HashMap::new();
            let (sx, sy, _) = &chip.net_label[net.src as usize];
            tile_of_wire.insert(net.src, (*sx, *sy));
            let rt = &out.routes[ni];
            let mut segs = vec![];
            // pips are appended sink -> tree; process in reverse so parents come first
            let mut pend: Vec<u32> = rt.iter().copied().filter(|p| !is_extra(*p)).collect();
            for _ in 0..4 {
                let mut rest = vec![];
                for &pp in pend.iter().rev() {
                    let p = &chip.pips[pp as usize];
                    let from = tile_of_wire.get(&p.src).copied();
                    match from {
                        Some((fx, fy)) => {
                            segs.push(json!([fx, fy, p.x, p.y, kind_name(chip.kind[p.dst as usize]), crit.contains(&pp)]));
                            tile_of_wire.insert(p.dst, (p.x as i32, p.y as i32));
                        }
                        None => rest.push(pp),
                    }
                }
                if rest.is_empty() { break; }
                rest.reverse();
                pend = rest;
            }
            json!({
                "name": net.name,
                "global": net.global.is_some(),
                "sinks": net.sinks.len(),
                "pips": rt.iter().filter(|p| !is_extra(**p)).count(),
                "segs": segs,
            })
        }).collect();
        Ok(json!({
            "ok": true,
            "top": top,
            "device": { "name": "iCE40UP5K-SG48", "w": chip.w, "h": chip.h, "tiles": tiles },
            "lcs": lcs,
            "chains": out.packed.chains.iter().map(|c| c.lcs.clone()).collect::<Vec<_>>(),
            "ios": ios,
            "rams": rams,
            "history": history,
            "nets": nets,
            "route_iters": out.route_iters,
            "globals": out.globals.iter().map(|(n, g)| json!({ "net": n, "glb": g })).collect::<Vec<_>>(),
            "timing": {
                "period": out.timing.period, "fmax": out.timing.fmax, "endpoints": out.timing.endpoints,
                "path": out.timing.path.iter().map(|s| json!({ "what": s.what, "delay": s.delay, "at": s.at })).collect::<Vec<_>>(),
                "crit_lcs": out.timing.crit_lcs,
                "fmax_wl": out.fmax_wl,
            },
            "pips": out.wires,
            "bin": base64(&veryl_eda::pnr::bitstream::asc_to_bin(&out.asc)?),
            "asc": out.asc,
            "pcf": out.pcf,
        }))
    })
}

type SynthOut = (veryl_eda::elab::Stages, Netlist);

/// parse + synthesize + map; (top, (stages, iCE40 netlist))
fn synth_netlists(v: &Value) -> R<(String, SynthOut)> {
    let fs = files(v)?;
    let mut parsers = vec![];
    for (name, src) in &fs {
        parsers.push(veryl_parser::Parser::parse(src, name).map_err(|e| veryl_sim::parse_err(name, src, &e))?);
    }
    let mut lib = veryl_eda::elab::Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    let top = match v.get("top").and_then(|t| t.as_str()) {
        Some(t) => t.to_string(),
        None => lib.order.iter().rev().find(|(_, t)| !t).map(|x| x.0.clone()).ok_or("no synthesizable (non-#[test]) module")?,
    };
    let st = veryl_eda::elab::synthesize_stages(&lib, &top)?;
    let mapped = veryl_eda::ice40::map(&st.opt)?;
    Ok((top, (st, mapped)))
}

fn synth(v: &Value) -> R<Value> {
    let fs = files(v)?;
    let mut parsers = vec![];
    for (name, src) in &fs {
        parsers.push(veryl_parser::Parser::parse(src, name).map_err(|e| veryl_sim::parse_err(name, src, &e))?);
    }
    let mut lib = veryl_eda::elab::Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    let top = match v.get("top").and_then(|t| t.as_str()) {
        Some(t) => t.to_string(),
        None => lib.order.iter().rev().find(|(_, t)| !t).map(|x| x.0.clone()).ok_or("no synthesizable (non-#[test]) module")?,
    };
    let st = veryl_eda::elab::synthesize_stages(&lib, &top)?;
    let mapped = veryl_eda::ice40::map(&st.opt)?;
    Ok(json!({
        "ok": true,
        "top": top,
        "modules": lib.order.iter().map(|(n, t)| json!({ "name": n, "test": t })).collect::<Vec<_>>(),
        "warnings": st.warnings,
        "hier": st.insts.iter().map(|(p, m)| json!({ "path": p, "module": m })).collect::<Vec<_>>(),
        "ports": st.ports.iter().map(|(n, d, w)| json!({ "name": n, "dir": dir(*d), "width": w })).collect::<Vec<_>>(),
        "signals": st.signals.iter().map(|(n, w)| json!({ "name": n, "width": w })).collect::<Vec<_>>(),
        "raw": netlist_json(&st.raw),
        "opt": netlist_json(&st.opt),
        "map": netlist_json(&mapped),
    }))
}

fn files(v: &Value) -> R<Vec<(String, String)>> {
    let a = v.get("files").and_then(|f| f.as_array()).ok_or("missing files")?;
    a.iter().map(|f| {
        let name = f.get("name").and_then(|x| x.as_str()).ok_or("file without name")?;
        let src = f.get("src").and_then(|x| x.as_str()).ok_or("file without src")?;
        Ok((name.to_string(), src.to_string()))
    }).collect()
}

pub fn dispatch(v: &Value) -> R<Value> {
    let cmd = v.get("cmd").and_then(|c| c.as_str()).ok_or("missing cmd")?;
    match cmd {
        "version" => Ok(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })),
        "list" => {
            let m = veryl_sim::list(&files(v)?)?;
            Ok(json!({ "ok": true, "modules": m.iter().map(|(n, t)| json!({ "name": n, "test": t })).collect::<Vec<_>>() }))
        }
        "simulate" => {
            let top = v.get("top").and_then(|t| t.as_str());
            let max_time = v.get("max_time").and_then(|t| t.as_u64()).unwrap_or(1_000_000);
            let vcd = v.get("vcd").and_then(|t| t.as_bool()).unwrap_or(false);
            let r = veryl_sim::run(&files(v)?, top, max_time, vcd, false)?;
            Ok(json!({
                "ok": true,
                "log": r.log,
                "tops": r.tops.iter().map(|t| json!({ "name": t.name, "fails": t.fails, "finished": t.finished })).collect::<Vec<_>>(),
                "vcd": r.vcd.iter().map(|(t, s)| json!({ "top": t, "text": s })).collect::<Vec<_>>(),
            }))
        }
        "synth" => synth(v),
        "pnr" => pnr(v),
        "asic" => asic(v),
        "chipdb_loaded" => Ok(json!({ "ok": true, "loaded": CHIP.with(|c| c.borrow().is_some()) })),
        c => Err(format!("unknown command '{}'", c)),
    }
}

fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}
