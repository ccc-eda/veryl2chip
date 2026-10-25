use std::path::PathBuf;

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
    let mut srcs = vec![];
    for f in &files {
        let src = std::fs::read_to_string(f).unwrap_or_else(|e| { eprintln!("{}: {}", f.display(), e); std::process::exit(1) });
        srcs.push((f.display().to_string(), src));
    }
    if list {
        match veryl_sim::list(&srcs) {
            Ok(m) => for (n, t) in m { println!("{}{}", n, if t { "  (#[test])" } else { "" }); },
            Err(e) => { eprintln!("{}", e); std::process::exit(1) }
        }
        return;
    }
    let r = veryl_sim::run(&srcs, top.as_deref(), max_time, vcd.is_some(), true).unwrap_or_else(|e| { eprintln!("{}", e); std::process::exit(1) });
    if let Some(path) = &vcd {
        for (t, text) in &r.vcd {
            let p = if r.vcd.len() > 1 && path.ends_with(".vcd") { path.replace(".vcd", &format!("_{}.vcd", t)) } else { path.clone() };
            if let Err(err) = std::fs::write(&p, text) { eprintln!("cannot write {}: {}", p, err); }
        }
    }
    if r.tops.iter().any(|t| t.fails > 0) { std::process::exit(1); }
}
