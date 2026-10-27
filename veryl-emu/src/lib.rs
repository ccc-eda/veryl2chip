//! veryl-emu: compiles a Veryl design (RTL, one clock) into a WebAssembly module
//! for fast cycle-based two-state simulation, in the spirit of Verilator. The
//! module runs in a browser or in Node with a harness that drives its ports
//! (`js/emu.mjs`). veryl-sim is not changed: veryl-emu uses its IR and parser
//! helpers as a library and has its own copy of the elaboration (`elab.rs`).

pub mod elab;
pub mod gen;
pub mod ir;
pub mod wasm;

use std::collections::HashMap;
use veryl_parser::Parser;

/// Elaborate `top` from the sources and compile it; `stops` end `run(n)` early.
pub fn compile(files: &[(String, String)], top: Option<&str>, stops: &[String]) -> Result<gen::Output, String> {
    let mut parsers = vec![];
    for (name, src) in files {
        parsers.push(Parser::parse(src, name).map_err(|e| veryl_sim::parse_err(name, src, &e))?);
    }
    let mut mods = vec![];
    for p in &parsers {
        for l in &p.veryl.veryl_list { elab::collect_modules(&l.description_group, &mut mods); }
    }
    let top = match top {
        Some(t) => t.to_string(),
        None => mods.iter().rev().find(|(_, t)| !*t).map(|(m, _)| m.identifier.identifier_token.to_string()).ok_or("no module found")?,
    };
    let decl = mods.iter().find(|(m, _)| m.identifier.identifier_token.to_string() == top).ok_or_else(|| format!("module '{}' not found", top))?.0;
    let mut e = elab::Elab::new(HashMap::new());
    e.lib = mods.iter().map(|(m, test)| (m.identifier.identifier_token.to_string(), elab::ModInfo { decl: m, is_test: *test })).collect();
    for p in &parsers {
        let mut v = vec![];
        for l in &p.veryl.veryl_list { veryl_sim::iface::collect(&l.description_group, &mut v); }
        for d in v { e.ifaces.insert(veryl_sim::iface::name(d), d); }
    }
    for p in &parsers {
        for l in &p.veryl.veryl_list { elab::collect_packages(&l.description_group, &mut e); }
    }
    e.elab_module(decl, "", &HashMap::new()).map_err(|m| format!("{}: elaboration error: {}", top, m))?;
    gen::compile(&e.sim, &e.procs, stops).map_err(|m| format!("{}: {}", top, m))
}
