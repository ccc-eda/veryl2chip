mod elab;
mod expr;
mod netlist;
#[cfg(test)]
mod netsim;
mod output;
mod value;

use std::path::PathBuf;
use veryl_parser::Parser;

fn usage() -> ! {
    eprintln!("usage: veryl-eda [--top MODULE] [-o OUT.json] [--verilog OUT.v] [--list] FILE.veryl...");
    eprintln!("  synthesizes MODULE (default: the last non-#[test] module) into a flat");
    eprintln!("  gate-level netlist of yosys internal cells and prints its statistics");
    std::process::exit(2);
}

fn main() {
    let (mut top, mut json, mut verilog, mut list) = (None::<String>, None::<String>, None::<String>, false);
    let mut files = vec![];
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--top" | "-s" => top = a.next(),
            "-o" | "--json" => json = a.next(),
            "--verilog" => verilog = a.next(),
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
    let mut lib = elab::Lib::new();
    for p in &parsers { lib.add(&p.veryl); }
    if list {
        for (n, t) in &lib.order { println!("{}{}", n, if *t { "  (#[test])" } else { "" }); }
        return;
    }
    let top = top.or_else(|| lib.order.iter().rev().find(|(_, t)| !t).map(|x| x.0.clone()))
        .unwrap_or_else(|| { eprintln!("no synthesizable (non-#[test]) module found"); std::process::exit(1) });

    let (nl, warnings) = match elab::synthesize(&lib, &top) {
        Ok(r) => r,
        Err(e) => { eprintln!("synthesis error in '{}': {}", top, e); std::process::exit(1) }
    };
    for w in warnings { eprintln!("warning: {}", w); }

    println!("=== {} ===", top);
    let st = nl.stats();
    let total: usize = st.iter().map(|x| x.1).sum();
    for p in &nl.ports { println!("  port {:6} {:3} {}", if p.dir == netlist::Dir::In { "input" } else { "output" }, p.bits.len(), p.name); }
    println!("  cells: {}", total);
    for (t, n) in st { println!("    {:14} {}", t, n); }

    if let Some(p) = json {
        std::fs::write(&p, output::to_json(&nl)).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
    if let Some(p) = verilog {
        std::fs::write(&p, output::to_verilog(&nl)).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
}

#[cfg(test)]
mod tests;
