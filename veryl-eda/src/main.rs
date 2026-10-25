use veryl_eda::{asic, elab, ice40, netlist, output, pnr};

use std::path::PathBuf;
use veryl_parser::Parser;

fn usage() -> ! {
    eprintln!("usage: veryl-eda [--top MODULE] [-o OUT.json] [--verilog OUT.v] [--list]");
    eprintln!("                 [--ice40 [--device up5k] [--package sg48] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]");
    eprintln!("                  [--pnr nextpnr|veryl] [--seed N] [--no-timing-driven]]");
    eprintln!("                 [--asic [--seed N] [-v]]");
    eprintln!("                 FILE.veryl...");
    eprintln!("  synthesizes MODULE (default: the last non-#[test] module) into a flat");
    eprintln!("  gate-level netlist of yosys internal cells and prints its statistics.");
    eprintln!("  --ice40 maps it to SB_LUT4/SB_DFF* cells; --asc/--bin then run");
    eprintln!("  place & route (nextpnr-ice40, or veryl-eda's own with --pnr veryl) and icepack.");
    eprintln!("  --asic maps to the vlib standard cells, places rows, routes and times them.");
    std::process::exit(2);
}

fn main() {
    let (mut top, mut json, mut verilog, mut list) = (None::<String>, None::<String>, None::<String>, false);
    let (mut ice40, mut pcf, mut asc, mut bin) = (false, None::<String>, None::<String>, None::<String>);
    let (mut device, mut package) = ("up5k".to_string(), "sg48".to_string());
    let (mut pnr_tool, mut seed, mut verbose) = ("nextpnr".to_string(), 1u64, false);
    let mut asic_flow = false;
    let mut timing_driven = true;
    let mut files = vec![];
    let mut a = std::env::args().skip(1);
    while let Some(x) = a.next() {
        match x.as_str() {
            "--top" | "-s" => top = a.next(),
            "-o" | "--json" => json = a.next(),
            "--verilog" => verilog = a.next(),
            "--list" => list = true,
            "--ice40" => ice40 = true,
            "--asic" => asic_flow = true,
            "--no-timing-driven" => timing_driven = false,
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
    let mut asic_out = None;
    if asic_flow {
        if ice40 { eprintln!("--asic and --ice40 exclude each other"); std::process::exit(2); }
        let out = asic::flow(&nl, seed).unwrap_or_else(|e| { eprintln!("ASIC flow error: {}", e); std::process::exit(1) });
        let mut out = out;
        nl = std::mem::replace(&mut out.mapped, netlist::Netlist { name: String::new(), ports: vec![], nets: vec![], cells: vec![] });
        asic_out = Some(out);
    }
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
    if let Some(o) = &asic_out {
        let (pl, rt, tm) = (&o.placement, &o.routing, &o.timing);
        println!("asic: area {:.1} µm² (cells), die {:.1} × {:.1} µm, {} rows, utilization {:.0}%", o.area, pl.w, pl.h, pl.rows, pl.util * 100.0);
        println!("asic: wirelength {:.0} µm, {} vias, overflow {} after {} routing iterations", rt.wirelength, rt.vias, rt.overflow, rt.iters.len());
        let pw = &o.power;
        println!("power: {:.3} mW at {:.1} MHz = dynamic {:.3} + leakage {:.4}; per cycle {:.2} pJ (nets {:.2}, clock {:.2}, internal {:.2}, SRAM {:.2}); IR drop worst {:.2} mV ({} random cycles)",
            pw.total, pw.freq_mhz, pw.dynamic, pw.leakage, pw.e_nets + pw.e_clock + pw.e_internal + pw.e_sram, pw.e_nets, pw.e_clock, pw.e_internal, pw.e_sram, pw.ir_worst, pw.cycles);
        let pd = &o.pdn;
        println!("asic: power grid {} rails, {} straps, {} via stacks; {} filler cells", pd.rails, pd.straps.len(), pd.vias.len(), pd.fillers.len());
        let d = &o.detail;
        println!("asic: detailed routing {:.0} µm (M2 {:.0} / M3 {:.0} / M4 {:.0} / M5 {:.0}), {} vias, {} conflicts, {} opens after {} iterations",
            d.wirelength, d.per_layer[0], d.per_layer[1], d.per_layer[2], d.per_layer[3], d.vias, d.conflicts, d.opens, d.iters.len());
        println!("asic: clock tree {} buffers ({}), insertion {:.3} ns, skew {:.3} ns; hold: worst slack {:.3} ns, {} delay buffers",
            o.cts.buffers, o.cts.trees.iter().map(|t| format!("{} sinks / {} levels", t.1, t.3)).collect::<Vec<_>>().join(", "), tm.insertion, tm.skew, tm.hold_slack, o.hold_bufs);
        println!("timing: critical path {:.3} ns, Fmax {:.1} MHz ({} endpoints; ideal clock {:.1} MHz, wirelength-only placement {:.1} MHz)", tm.period, tm.fmax, tm.endpoints, o.fmax_ideal, o.fmax_wl);
        if verbose { for s in &tm.path { println!("  {:8.3} {:+7.3}  {}", s.at, s.delay, s.what); } }
    }

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
            let opts = pnr::Opts { chipdb: None, package: package.clone(), pcf: pcf_map, seed, verbose, timing_driven };
            let out = pnr::place_and_route(&nl, &opts).unwrap_or_else(|e| { eprintln!("place & route error: {}", e); std::process::exit(1) });
            println!("  veryl pnr: {} LCs, {} routing pips, {:.1}s", out.lcs, out.wires, t0.elapsed().as_secs_f64());
            let pw = &out.power;
            println!("  power: {:.3} mW at {:.1} MHz = dynamic {:.3} + static {:.3}; per cycle {:.1} pJ (nets {:.1}, clock {:.1}, RAM {:.1})",
                pw.total, pw.freq_mhz, pw.dynamic, pw.static_mw, pw.e_nets + pw.e_clock + pw.e_ram, pw.e_nets, pw.e_clock, pw.e_ram);
            println!("  timing: critical path {:.2} ns, Fmax {:.2} MHz{}", out.timing.period, out.timing.fmax,
                out.fmax_wl.map(|f| format!(" (wirelength-only pass {:.2} MHz)", f)).unwrap_or_default());
            if verbose { for st in &out.timing.path { println!("    {:7.3} {:6.3}  {}", st.at, st.delay, st.what); } }
            std::fs::write(&asc_path, &out.asc).unwrap();
            std::fs::write(asc_path.with_extension("pcf"), &out.pcf).unwrap();
            println!("wrote {} (+ .pcf)", asc_path.display());
            if let Some(b) = &bin {
                // own port of icepack (UP5K)
                let bits = pnr::bitstream::asc_to_bin(&out.asc).unwrap_or_else(|e| { eprintln!("bitstream: {}", e); std::process::exit(1) });
                std::fs::write(b, bits).unwrap();
                println!("wrote {}", b);
            }
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
        if let (Some(b), false) = (&bin, pnr_tool == "veryl") {
            let st = std::process::Command::new("icepack").arg(&asc_path).arg(b).status()
                .unwrap_or_else(|e| { eprintln!("cannot run icepack: {}", e); std::process::exit(1) });
            if !st.success() { eprintln!("icepack failed"); std::process::exit(1); }
            println!("wrote {}", b);
        }
    }
    if let Some(p) = verilog {
        let mut v = output::to_verilog(&nl);
        if asic_out.is_some() { v += &asic::lib::verilog_models(); }
        std::fs::write(&p, v).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
}
