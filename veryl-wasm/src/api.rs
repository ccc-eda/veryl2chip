//! The requests the web front end can make.

use serde_json::{json, Value};
use veryl_eda::netlist::{Bit, Dir, Netlist};

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
        c => Err(format!("unknown command '{}'", c)),
    }
}
