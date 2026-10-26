//! veryl-sim as a library: parse Veryl sources, elaborate, simulate.
//! Used by the command line (`cli.rs`: `veryl-sim`, `v2c sim`) and the WebAssembly build.

#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
pub mod elab;
pub mod gates;
pub mod gen;
pub mod iface;
pub mod expr;
pub mod sim;
pub mod value;

use std::collections::HashMap;
use veryl_parser::Parser;

pub struct TopResult {
    pub name: String,
    pub fails: u32,
    pub finished: bool,
}

pub struct RunResult {
    /// everything printed while simulating, all tops in order
    pub log: String,
    pub tops: Vec<TopResult>,
    /// (top, VCD text) when waveforms were requested
    pub vcd: Vec<(String, String)>,
}

/// parse error as `file:line:col: parse error: ...` (plus the parser's hint)
pub fn parse_err(file: &str, src: &str, e: &veryl_parser::ParserError) -> String {
    let s = format!("{}", e);
    let s = if s.is_empty() { format!("{:?}", e) } else { s };
    if let veryl_parser::ParserError::SyntaxError(se) = e {
        let off = se.error_location.offset().min(src.len());
        let before = &src[..off];
        let line = before.matches('\n').count() + 1;
        let col = off - before.rfind('\n').map(|i| i + 1).unwrap_or(0) + 1;
        let help = if se.help.is_empty() { String::new() } else { format!("\n  hint: {}", se.help) };
        return format!("{}:{}:{}: parse error: {}{}", file, line, col, s, help);
    }
    format!("{}: parse error: {}", file, s)
}

fn parse_all(files: &[(String, String)]) -> Result<Vec<Parser>, String> {
    let mut v = vec![];
    for (name, src) in files {
        v.push(Parser::parse(src, name).map_err(|e| parse_err(name, src, &e))?);
    }
    Ok(v)
}

/// all modules in declaration order: (name, has #[test])
pub fn list(files: &[(String, String)]) -> Result<Vec<(String, bool)>, String> {
    let parsers = parse_all(files)?;
    let mut mods = vec![];
    for p in &parsers {
        for l in &p.veryl.veryl_list { elab::collect_modules(&l.description_group, &mut mods); }
    }
    Ok(mods.iter().map(|(m, t)| (m.identifier.identifier_token.to_string(), *t)).collect())
}

/// Simulate `top` (default: every #[test] module, else the last module).
pub fn run(files: &[(String, String)], top: Option<&str>, max_time: u64, vcd: bool, echo: bool) -> Result<RunResult, String> {
    run_gates(files, top, max_time, vcd, echo, None)
}

/// like `run`, but every module instance for which `gates` gives a netlist
/// is simulated from those gates (post-synthesis simulation with the RTL
/// testbenches); `gates` gets the module name and the instance's parameter
/// overrides
pub fn run_gates(files: &[(String, String)], top: Option<&str>, max_time: u64, vcd: bool, echo: bool, gates: Option<&gates::GateFn>) -> Result<RunResult, String> {
    let parsers = parse_all(files)?;
    let mut mods = vec![];
    for p in &parsers {
        for l in &p.veryl.veryl_list { elab::collect_modules(&l.description_group, &mut mods); }
    }
    let order: Vec<(String, bool)> = mods.iter().map(|(m, t)| (m.identifier.identifier_token.to_string(), *t)).collect();
    let tops: Vec<String> = match top {
        Some(t) => vec![t.to_string()],
        None => {
            let tests: Vec<String> = order.iter().filter(|(_, t)| *t).map(|(n, _)| n.clone()).collect();
            if !tests.is_empty() { tests } else { vec![order.last().ok_or("no module found")?.0.clone()] }
        }
    };
    let mut res = RunResult { log: String::new(), tops: vec![], vcd: vec![] };
    for t in tops {
        let decl = mods.iter().find(|(m, _)| m.identifier.identifier_token.to_string() == t).ok_or_else(|| format!("module '{}' not found", t))?.0;
        let say = |s: &str, res: &mut RunResult| { if echo { println!("{}", s); } res.log.push_str(s); res.log.push('\n'); };
        say(&format!("=== simulating {} ===", t), &mut res);
        let mut e = elab::Elab::new(HashMap::new());
        e.gates = gates;
        e.lib = mods.iter().map(|(m, test)| (m.identifier.identifier_token.to_string(), elab::ModInfo { decl: m, is_test: *test })).collect();
        for p in &parsers {
            let mut v = vec![];
            for l in &p.veryl.veryl_list { iface::collect(&l.description_group, &mut v); }
            for d in v { e.ifaces.insert(iface::name(d), d); }
        }
        for p in &parsers {
            for l in &p.veryl.veryl_list { elab::collect_packages(&l.description_group, &mut e); }
        }
        if let Err(msg) = e.elab_module(decl, "", &HashMap::new()) {
            return Err(format!("{}: elaboration error: {}", t, msg));
        }
        let mut d = sim::Design::new(e.sim, e.procs, e.inits, e.watched);
        d.sim.echo = echo;
        if vcd { let _ = d.enable_vcd(); }
        d.run(max_time);
        res.log.push_str(&d.sim.log.borrow());
        let r = TopResult { name: t.clone(), fails: d.sim.fails, finished: d.sim.finished };
        say(&if r.fails > 0 { format!("{}: {} failure(s)", t, r.fails) } else { format!("{}: PASS", t) }, &mut res);
        if let Some(v) = d.take_vcd() { res.vcd.push((t.clone(), String::from_utf8_lossy(&v).to_string())); }
        res.tops.push(r);
    }
    Ok(res)
}
