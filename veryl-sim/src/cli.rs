//! The `veryl-sim` command line, also `v2c sim` / `v2c list` (veryl-eda's v2c).

use std::path::PathBuf;
use std::sync::OnceLock;

/// set by `v2c` to its subcommand: argument errors point to `v2c help <subcommand>`
pub static V2C: OnceLock<&'static str> = OnceLock::new();

fn usage() -> ! {
    if let Some(cmd) = V2C.get() { eprintln!("v2c {}: wrong arguments (v2c help {})", cmd, cmd); }
    else { eprintln!("usage: veryl-sim [--top MODULE] [--vcd FILE] [--max-time N] [--list] FILE.veryl..."); }
    std::process::exit(2);
}

/// run the simulator with command-line arguments (without the program name); exits on errors
pub fn main(args: &[String]) {
    let (mut top, mut vcd, mut max_time, mut list) = (None::<String>, None::<String>, 1_000_000u64, false);
    let mut files = vec![];
    let mut a = args.iter().cloned();
    while let Some(x) = a.next() {
        match x.as_str() {
            "--top" | "-s" => top = a.next(),
            "--vcd" | "-o" => vcd = a.next(),
            "--max-time" => max_time = a.next().and_then(|s| s.parse().ok()).unwrap_or_else(|| usage()),
            "--list" => list = true,
            "-h" | "--help" => usage(),
            o if o.starts_with('-') && o.len() > 1 => { eprintln!("unknown option {}", o); usage() }
            _ => files.push(PathBuf::from(x)),
        }
    }
    if files.is_empty() { usage(); }
    let mut srcs = vec![];
    for f in &files {
        let src = std::fs::read_to_string(f).unwrap_or_else(|e| { eprintln!("{}: {}", f.display(), e); std::process::exit(1) });
        srcs.push((f.display().to_string(), src));
    }
    if list {
        match crate::list(&srcs) {
            Ok(m) => for (n, t) in m { println!("{}{}", n, if t { "  (#[test])" } else { "" }); },
            Err(e) => { eprintln!("{}", e); std::process::exit(1) }
        }
        return;
    }
    let r = crate::run(&srcs, top.as_deref(), max_time, vcd.is_some(), true).unwrap_or_else(|e| { eprintln!("{}", e); std::process::exit(1) });
    if let Some(path) = &vcd {
        for (t, text) in &r.vcd {
            let p = if r.vcd.len() > 1 && path.ends_with(".vcd") { path.replace(".vcd", &format!("_{}.vcd", t)) } else { path.clone() };
            if let Err(err) = std::fs::write(&p, text) { eprintln!("cannot write {}: {}", p, err); }
        }
    }
    if r.tops.iter().any(|t| t.fails > 0) { std::process::exit(1); }
}
