mod elab;
mod expr;
mod sim;
mod value;

use std::collections::HashMap;
use std::path::PathBuf;
use veryl_parser::Parser;

fn usage() -> ! {
    eprintln!("usage: veryl-sim [--top MODULE] [--vcd FILE] [--max-time N] [--list] FILE.veryl...");
    std::process::exit(2);
}

fn main() {
    let (mut top, mut vcd, mut max_time, mut list) = (None::<String>, None::<String>, 1_000_000u64, false);
    let mut files = vec![];
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--top" | "-s" => top = a.next(),
            "--vcd" | "-o" => vcd = a.next(),
            "--max-time" => max_time = a.next().and_then(|s| s.parse().ok()).unwrap_or_else(|| usage()),
            "--list" => list = true,
            "-h" | "--help" => usage(),
            _ => files.push(PathBuf::from(x)),
        }
    }
    if files.is_empty() { usage(); }

    let mut parsers = vec![];
    for f in &files {
        let src = std::fs::read_to_string(f).unwrap_or_else(|e| { eprintln!("{}: {}", f.display(), e); std::process::exit(1) });
        match Parser::parse(&src, f) {
            Ok(p) => parsers.push(p),
            Err(e) => { eprintln!("{}: parse error: {:?}", f.display(), e); std::process::exit(1) }
        }
    }

    let mut mods = vec![];
    for p in &parsers {
        for l in &p.veryl.veryl_list { elab::collect_modules(&l.description_group, &mut mods); }
    }
    let mut order = vec![];
    let mut lib = HashMap::new();
    for (m, is_test) in mods {
        let name = m.identifier.identifier_token.to_string();
        order.push((name.clone(), is_test));
        lib.insert(name, elab::ModInfo { decl: m, is_test });
    }
    if list {
        for (n, t) in &order { println!("{}{}", n, if *t { "  (#[test])" } else { "" }); }
        return;
    }

    // which modules to run as top-level?
    let tops: Vec<String> = if let Some(t) = top { vec![t] } else {
        let tests: Vec<String> = order.iter().filter(|(_, t)| *t).map(|(n, _)| n.clone()).collect();
        if !tests.is_empty() { tests } else {
            // no #[test] module: simulate the last module declared
            vec![order.last().map(|x| x.0.clone()).unwrap_or_else(|| { eprintln!("no module found"); std::process::exit(1) })]
        }
    };

    let mut failed = false;
    let tops_len = tops.len();
    for t in tops {
        let Some(info) = lib.get(&t) else { eprintln!("module '{}' not found", t); std::process::exit(1) };
        let decl = info.decl;
        println!("=== simulating {} ===", t);
        let mut e = elab::Elab::new(HashMap::new());
        e.lib = lib.iter().map(|(k, v)| (k.clone(), elab::ModInfo { decl: v.decl, is_test: v.is_test })).collect();
        for p in &parsers {
            for l in &p.veryl.veryl_list { elab::collect_packages(&l.description_group, &mut e); }
        }
        if let Err(msg) = e.elab_module(decl, "", &HashMap::new()) {
            eprintln!("elaboration error: {}", msg);
            std::process::exit(1);
        }
        let mut d = sim::Design::new(e.sim, e.procs, e.inits, e.watched);
        if let Some(path) = &vcd {
            let p = if tops_len > 1 && path.ends_with(".vcd") { path.replace(".vcd", &format!("_{}.vcd", t)) } else { path.clone() };
            if let Err(err) = d.enable_vcd(&p) { eprintln!("cannot open {}: {}", p, err); }
        }
        d.run(max_time);
        if d.sim.fails > 0 { println!("{}: {} failure(s)", t, d.sim.fails); failed = true; } else { println!("{}: PASS", t); }
    }
    if failed { std::process::exit(1); }
}
