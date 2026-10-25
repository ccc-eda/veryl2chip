mod elab;
mod expr;
mod ice40;
mod netlist;
#[cfg(test)]
mod netsim;
mod output;
mod pnr;
mod value;

use std::path::PathBuf;
use veryl_parser::Parser;

fn usage() -> ! {
    eprintln!("usage: veryl-eda [--top MODULE] [-o OUT.json] [--verilog OUT.v] [--list]");
    eprintln!("                 [--ice40 [--device up5k] [--package sg48] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]");
    eprintln!("                  [--pnr nextpnr|veryl] [--seed N]]");
    eprintln!("                 FILE.veryl...");
    eprintln!("  synthesizes MODULE (default: the last non-#[test] module) into a flat");
    eprintln!("  gate-level netlist of yosys internal cells and prints its statistics.");
    eprintln!("  --ice40 maps it to SB_LUT4/SB_DFF* cells; --asc/--bin then run");
    eprintln!("  place & route (nextpnr-ice40, or veryl-eda's own with --pnr veryl) and icepack.");
    std::process::exit(2);
}

fn main() {
    let (mut top, mut json, mut verilog, mut list) = (None::<String>, None::<String>, None::<String>, false);
    let (mut ice40, mut pcf, mut asc, mut bin) = (false, None::<String>, None::<String>, None::<String>);
    let (mut device, mut package) = ("up5k".to_string(), "sg48".to_string());
    let (mut pnr_tool, mut seed, mut verbose) = ("nextpnr".to_string(), 1u64, false);
    let mut files = vec![];
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--top" | "-s" => top = a.next(),
            "-o" | "--json" => json = a.next(),
            "--verilog" => verilog = a.next(),
            "--list" => list = true,
            "--ice40" => ice40 = true,
            "--pcf" => pcf = a.next(),
            "--asc" => asc = a.next(),
            "--bin" => bin = a.next(),
            "--device" => device = a.next().unwrap_or_else(|| usage()),
            "--package" => package = a.next().unwrap_or_else(|| usage()),
            "--pnr" => pnr_tool = a.next().unwrap_or_else(|| usage()),
            "--seed" => seed = a.next().and_then(|s| s.parse().ok()).unwrap_or_else(|| usage()),
            "-v" | "--verbose" => verbose = true,
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

    let (mut nl, warnings) = match elab::synthesize(&lib, &top) {
        Ok(r) => r,
        Err(e) => { eprintln!("synthesis error in '{}': {}", top, e); std::process::exit(1) }
    };
    if asc.is_some() || bin.is_some() { ice40 = true; }
    if ice40 {
        nl = ice40::map(&nl).unwrap_or_else(|e| { eprintln!("iCE40 mapping error: {}", e); std::process::exit(1) });
    }
    for w in warnings { eprintln!("warning: {}", w); }

    println!("=== {} ===", top);
    let st = nl.stats();
    let total: usize = st.iter().map(|x| x.1).sum();
    for p in &nl.ports { println!("  port {:6} {:3} {}", if p.dir == netlist::Dir::In { "input" } else { "output" }, p.bits.len(), p.name); }
    println!("  cells: {}", total);
    for (t, n) in st { println!("    {:14} {}", t, n); }

    if let Some(p) = &json {
        std::fs::write(&p, output::to_json(&nl)).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
    if asc.is_some() || bin.is_some() {
        let dir = std::env::temp_dir().join(format!("veryl-eda-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mapped = json.clone().map(PathBuf::from).unwrap_or_else(|| dir.join("mapped.json"));
        std::fs::write(&mapped, output::to_json(&nl)).unwrap();
        let asc_path = asc.clone().map(PathBuf::from).unwrap_or_else(|| dir.join("out.asc"));
        if pnr_tool == "veryl" {
            if device != "up5k" { eprintln!("--pnr veryl supports only --device up5k"); std::process::exit(1); }
            let pcf_map = match &pcf {
                Some(p) => pnr::parse_pcf(&std::fs::read_to_string(p).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) })),
                None => Default::default(),
            };
            let t0 = std::time::Instant::now();
            let opts = pnr::Opts { chipdb: None, package: package.clone(), pcf: pcf_map, seed, verbose };
            let out = pnr::place_and_route(&nl, &opts).unwrap_or_else(|e| { eprintln!("place & route error: {}", e); std::process::exit(1) });
            println!("  veryl pnr: {} LCs, {} routing pips, {:.1}s", out.lcs, out.wires, t0.elapsed().as_secs_f64());
            std::fs::write(&asc_path, &out.asc).unwrap();
            std::fs::write(asc_path.with_extension("pcf"), &out.pcf).unwrap();
            println!("wrote {} (+ .pcf)", asc_path.display());
        } else {
        let mut cmd = std::process::Command::new("nextpnr-ice40");
        cmd.arg(format!("--{}", device)).args(["--package", &package, "--json"]).arg(&mapped).arg("--asc").arg(&asc_path);
        match &pcf { Some(p) => { cmd.args(["--pcf", p]); } None => { cmd.arg("--pcf-allow-unconstrained"); } }
        println!("running {:?}", cmd);
        let out = cmd.output().unwrap_or_else(|e| { eprintln!("cannot run nextpnr-ice40: {}", e); std::process::exit(1) });
        let log = String::from_utf8_lossy(&out.stderr);
        for l in log.lines().filter(|l| l.contains("ICESTORM_LC:") || l.contains("Max frequency") || l.contains("ERROR")) {
            println!("  {}", l.trim_start_matches("Info:").trim());
        }
        if !out.status.success() { eprintln!("nextpnr-ice40 failed"); std::process::exit(1); }
        println!("wrote {}", asc_path.display());
        }
        if let Some(b) = &bin {
            let st = std::process::Command::new("icepack").arg(&asc_path).arg(b).status()
                .unwrap_or_else(|e| { eprintln!("cannot run icepack: {}", e); std::process::exit(1) });
            if !st.success() { eprintln!("icepack failed"); std::process::exit(1); }
            println!("wrote {}", b);
        }
    }
    if let Some(p) = verilog {
        std::fs::write(&p, output::to_verilog(&nl)).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
}

#[cfg(test)]
mod tests;
