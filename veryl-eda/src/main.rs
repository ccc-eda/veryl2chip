use veryl_eda::{asic, bram, elab, ice40, netlist, output, pnr, rv};

use std::path::PathBuf;
use veryl_parser::Parser;

fn usage() -> ! {
    eprintln!("usage: veryl-eda [--top MODULE] [-o OUT.json] [--verilog OUT.v] [--list]");
    eprintln!("       veryl-eda --cc PROG.c [-o PROG.bin] [-S PROG.s] [-L PROG.lst] [--run [N]] [--mem BYTES]   (C for RvSoc; PROG.s: assemble)");
    eprintln!("                 [--ice40 [--device up5k] [--package sg48] [--pcf PINS.pcf] [--asc OUT.asc] [--bin OUT.bin]");
    eprintln!("                  [--pnr nextpnr|veryl] [--seed N] [--no-timing-driven] [--program PROG.bin]]");
    eprintln!("                 [--asic [--pdk vlib|sky130|sky130:DIR] [--seed N] [--def OUT.def] [--gds OUT.gds] [-v]] [--gatesim opt|ice40|asic|sky130]");
    eprintln!("                 FILE.veryl...");
    eprintln!("       veryl-eda --pdk-check [DIR]   (read a SKY130 Liberty + LEF directory, check the cell bindings)");
    eprintln!("  synthesizes MODULE (default: the last non-#[test] module) into a flat");
    eprintln!("  gate-level netlist of yosys internal cells and prints its statistics.");
    eprintln!("  --ice40 maps it to SB_LUT4/SB_DFF* cells; --asc/--bin then run");
    eprintln!("  place & route (nextpnr-ice40, or veryl-eda's own with --pnr veryl) and icepack.");
    eprintln!("  --program puts a binary (from address 0) into the block RAMs of a byte-lane");
    eprintln!("  program memory (*.b0.mem .. *.b3.mem, e.g. RvBoard in examples/src/rvsoc.veryl).");
    eprintln!("  --asic maps to standard cells (vlib, or SkyWater SKY130 sky130_fd_sc_hd with --pdk sky130),");
    eprintln!("  places rows, routes and times them; --verilog / --def write the library's names;");
    eprintln!("  --map-only stops after the technology mapping (a netlist for --verilog);");
    eprintln!("  --gds OUT.gds writes the layout (SKY130: the PDK's cells + routing) as GDSII.");
    eprintln!("  --gatesim opt|ice40|asic runs the #[test] testbenches against the synthesized");
    eprintln!("  netlist of MODULE instead of its RTL (post-synthesis simulation).");
    std::process::exit(2);
}

/// `veryl-eda --cc prog.c [-o prog.bin] [-S prog.s] [-L prog.lst] [--run [N]]`: compile C for RvSoc
fn cc_main(args: &[String]) -> ! {
    let (mut src, mut out, mut asm_out, mut run, mut mem) = (None::<String>, None::<String>, None::<String>, None::<u64>, 8192u32);
    let mut lst: Option<String> = None;
    let mut a = args.iter();
    while let Some(x) = a.next() {
        match x.as_str() {
            "-o" => out = a.next().cloned(),
            "-S" => asm_out = a.next().cloned(),
            "-L" => lst = a.next().cloned(),
            "--run" => run = Some(a.clone().next().and_then(|n| n.parse().ok()).inspect(|_| { a.next(); }).unwrap_or(10_000_000)),
            "--mem" => mem = a.next().and_then(|n| n.parse().ok()).unwrap_or_else(|| usage()),
            f if !f.starts_with('-') => src = Some(f.to_string()),
            _ => usage(),
        }
    }
    let Some(path) = src else { usage() };
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| { eprintln!("{}: {}", path, e); std::process::exit(1) });
    let name = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().to_string();
    // an assembly file: just the assembler
    if name.ends_with(".s") || name.ends_with(".S") {
        let p = rv::asm::assemble(&text).unwrap_or_else(|es| { for e in es { eprintln!("{}:{}: error: {}", name, e.line, e.msg); } std::process::exit(1) });
        if let Some(o) = &out { std::fs::write(o, &p.bytes).unwrap(); }
        if let Some(l) = &lst { std::fs::write(l, rv::asm::listing_text(&p)).unwrap(); }
        eprintln!("{}: {} bytes", name, p.bytes.len());
        std::process::exit(0);
    }
    let o = match rv::cc::compile(&name, &text, &rv::cc::Options { mem_size: mem }) {
        Ok(o) => o,
        Err(es) => { for e in es { eprintln!("{}:{}: error: {}", e.file, e.line, e.msg); } std::process::exit(1) }
    };
    eprintln!("{}: {} bytes of code and data, {} with bss (RAM {} bytes)", name, o.program.bytes.len(), o.program.end, mem);
    if let Some(p) = &asm_out { std::fs::write(p, &o.asm).unwrap(); }
    if let Some(p) = &lst { std::fs::write(p, rv::asm::listing_text(&o.program)).unwrap(); }
    if let Some(p) = &out { std::fs::write(p, &o.program.bytes).unwrap(); }
    if let Some(n) = run {
        let mut s = rv::iss::Iss::new(&o.program.bytes, mem as usize);
        let halted = s.run(n).unwrap_or_else(|e| { eprintln!("{}", e); std::process::exit(1) });
        print!("{}", String::from_utf8_lossy(&s.tx));
        eprintln!("{} after {} instructions ({} cycles); LED = 0x{:02x}", if halted { "halted" } else { "stopped" }, s.instret, s.cycles, s.led);
    }
    std::process::exit(0)
}

/// `veryl-eda --pdk-check [DIR]`: read SKY130's Liberty and LEF files, print what the flow uses
fn pdk_check(dir: Option<&String>) -> ! {
    use veryl_eda::pdk;
    let d = dir.map(PathBuf::from).or_else(pdk::sky130_dir).unwrap_or_else(|| { eprintln!("no SKY130 directory (give one, or set VERYL_EDA_SKY130)"); std::process::exit(1) });
    let t0 = std::time::Instant::now();
    let t = pdk::sky130_from_dir(&d).unwrap_or_else(|e| { eprintln!("{}: {}", d.display(), e); std::process::exit(1) });
    let (lib, lef) = (t.liberty.as_ref().unwrap(), t.lef.as_ref().unwrap());
    println!("{}: Liberty {} ({} cells, {} V), LEF {} macros, {} layers, {} vias  ({:.2} s)", d.display(), lib.name, lib.cells.len(), lib.voltage, lef.macros.len(), lef.layers.len(), lef.vias.len(), t0.elapsed().as_secs_f64());
    println!("site {} {} x {} µm, {} tracks per row; routing:", t.site, t.site_w, t.row_h, t.tracks);
    for l in lef.routing() { println!("  {:5} {} pitch {} width {} spacing {} R {} Ω/sq", l.name, if l.horizontal { "H" } else { "V" }, if l.horizontal { l.pitch.1 } else { l.pitch.0 }, l.width, l.spacing, l.rpersq); }
    let mut names: Vec<&String> = t.cells.keys().collect();
    names.sort();
    println!("logical cell -> library cell (function checked against the Liberty file), width in sites, pin access");
    for n in names {
        let b = &t.cells[n];
        let acc: Vec<String> = b.access.iter().map(|a| format!("{}={}@{},{}", a.0, b.lib_pin(a.0), a.1, a.2)).collect();
        println!("  {:7} {:28} {:3} {:7.3} µm²  {}", n, b.cell, b.width, b.area, acc.join(" "));
    }
    std::process::exit(0)
}

fn main() {
    let all: Vec<String> = std::env::args().skip(1).collect();
    if all.first().map(|a| a == "--cc") == Some(true) { cc_main(&all[1..]); }
    if all.first().map(|a| a == "--pdk-check") == Some(true) { pdk_check(all.get(1)); }
    let (mut top, mut json, mut verilog, mut list) = (None::<String>, None::<String>, None::<String>, false);
    let (mut ice40, mut pcf, mut asc, mut bin) = (false, None::<String>, None::<String>, None::<String>);
    let (mut device, mut package) = ("up5k".to_string(), "sg48".to_string());
    let (mut pnr_tool, mut seed, mut verbose) = ("nextpnr".to_string(), 1u64, false);
    let mut asic_flow = false;
    let mut pdk_name = "vlib".to_string();
    let mut def_out: Option<String> = None;
    let mut map_only = false;
    let mut gds_out: Option<String> = None;
    let mut gatesim: Option<String> = None;
    let mut timing_driven = true;
    let mut program: Option<String> = None;
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
            "--pdk" => pdk_name = a.next().unwrap_or_else(|| usage()),
            "--def" => def_out = a.next(),
            "--map-only" => map_only = true,
            "--gds" => gds_out = a.next(),
            "--gatesim" => gatesim = Some(a.next().unwrap_or_else(|| usage())),
            "--no-timing-driven" => timing_driven = false,
            "--pcf" => pcf = a.next(),
            "--asc" => asc = a.next(),
            "--bin" => bin = a.next(),
            "--program" => program = a.next(),
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
    let tech = veryl_eda::pdk::by_name(&pdk_name).unwrap_or_else(|e| { eprintln!("--pdk: {}", e); std::process::exit(2) });
    veryl_eda::pdk::set_tech(Some(tech.clone()));

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

    if let Some(kind) = &gatesim {
        let srcs: Vec<(String, String)> = files.iter().map(|f| (f.display().to_string(), std::fs::read_to_string(f).unwrap())).collect();
        let prov = veryl_eda::gatesim::Provider::new(&lib, &top, kind);
        let f = |m: &str, ov: &std::collections::HashMap<String, veryl_sim::value::Val>| prov.get(m, ov);
        let r = veryl_sim::run_gates(&srcs, None, 1_000_000, false, true, Some(&f));
        for (ps, n) in prov.built.borrow().iter() {
            println!("gate-level simulation: {}{} as {} cells ({})", top, if ps.is_empty() { String::new() } else { format!(" #({})", ps) }, n, kind);
        }
        match r {
            Ok(r) => std::process::exit(if r.tops.iter().any(|t| t.fails > 0) { 1 } else { 0 }),
            Err(e) => { eprintln!("{}", e); std::process::exit(1) }
        }
    }
    let (mut nl, warnings) = match elab::synthesize(&lib, &top) {
        Ok(r) => r,
        Err(e) => { eprintln!("synthesis error in '{}': {}", top, e); std::process::exit(1) }
    };
    if asc.is_some() || bin.is_some() { ice40 = true; }
    let mut asic_out = None;
    let mut asic_models = false;
    if asic_flow {
        if ice40 { eprintln!("--asic and --ice40 exclude each other"); std::process::exit(2); }
        if !tech.is_vlib() { println!("asic: technology {} ({} µm rows, {} µm sites)", tech.name, tech.row_h, tech.site_w); }
        if map_only {
            // technology mapping only (no place & route): for the netlist
            let m = asic::map::map(&nl).unwrap_or_else(|e| { eprintln!("ASIC mapping error: {}", e); std::process::exit(1) });
            nl = veryl_eda::pdk::to_library(&m);
            if verilog.is_some() { asic_models = true; }
        } else {
            let out = asic::flow(&nl, seed).unwrap_or_else(|e| { eprintln!("ASIC flow error: {}", e); std::process::exit(1) });
            nl = veryl_eda::pdk::to_library(&out.mapped);
            asic_out = Some(out);
        }
    }
    if ice40 {
        nl = ice40::map(&nl).unwrap_or_else(|e| { eprintln!("iCE40 mapping error: {}", e); std::process::exit(1) });
        if let Some(p) = &program {
            let bytes = std::fs::read(p).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
            let lanes = bram::program_lanes(&bram::mem_names(&nl), &bytes).unwrap_or_else(|e| { eprintln!("--program: {}", e); std::process::exit(1) });
            for (m, words) in lanes { bram::set_mem_init(&mut nl, &m, &words); }
            println!("program: {} bytes in the block RAMs", bytes.len());
        }
    } else if program.is_some() {
        eprintln!("--program needs --ice40"); std::process::exit(2);
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
        println!("asic: area {:.1} µm² (cells), die {:.1} × {:.1} µm, {} rows, utilization {:.0}%, fullest 16 µm bin {:.0}% (target {:.0}%)", o.area, pl.w, pl.h, pl.rows, pl.util * 100.0, pl.max_density * 100.0, pl.target_density * 100.0);
        println!("asic: wirelength {:.0} µm, {} vias, overflow {} after {} routing iterations", rt.wirelength, rt.vias, rt.overflow, rt.iters.len());
        let pw = &o.power;
        println!("power: {:.3} mW at {:.1} MHz = dynamic {:.3} + leakage {:.4}; per cycle {:.2} pJ (nets {:.2}, clock {:.2}, internal {:.2}, SRAM {:.2}); IR drop worst {:.2} mV ({} random cycles)",
            pw.total, pw.freq_mhz, pw.dynamic, pw.leakage, pw.e_nets + pw.e_clock + pw.e_internal + pw.e_sram, pw.e_nets, pw.e_clock, pw.e_internal, pw.e_sram, pw.ir_worst, pw.cycles);
        let pd = &o.pdn;
        println!("asic: power grid {} rails, {} straps, {} via stacks; {} filler cells", pd.rails, pd.straps.len(), pd.vias.len(), pd.fillers.len());
        let d = &o.detail;
        if !tech.is_vlib() {
            match asic::layout::build(o) {
                Ok(l) => {
                    let r = asic::drc::check(&l, &o.mapped);
                    println!("asic: DRC {} shapes: {} shorts, {} spacing, {} min-area, {} opens; {} taps ({} sites too far)", r.shapes, r.shorts, r.spacing, r.area, r.opens, o.pdn.taps.len(), o.pdn.tap_viol);
                    if verbose { for e in &r.details { println!("  {}", e); } }
                }
                Err(e) => println!("asic: layout: {}", e),
            }
        }
        let per: Vec<String> = (0..4).map(|l| format!("{} {:.0}", tech.layers[l], d.per_layer[l])).collect();
        println!("asic: detailed routing {:.0} µm ({}), {} vias, {} conflicts, {} opens after {} iterations",
            d.wirelength, per.join(" / "), d.vias, d.conflicts, d.opens, d.iters.len());
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
    if let (Some(p), Some(o)) = (&gds_out, &asic_out) {
        if tech.is_vlib() { eprintln!("--gds needs a PDK with cell layouts (--pdk sky130)"); std::process::exit(2); }
        let l = asic::layout::build(o).unwrap_or_else(|e| { eprintln!("layout: {}", e); std::process::exit(1) });
        let g = asic::gds::write(&l, &o.mapped.name, veryl_eda::pdk::SKY130_GDS).unwrap_or_else(|e| { eprintln!("GDS: {}", e); std::process::exit(1) });
        std::fs::write(p, &g).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {} ({} bytes: {} cell instances, {} shapes, {} labels)", p, g.len(), l.insts.len(), l.shapes.len(), l.labels.len());
    }
    if let (Some(p), Some(o)) = (&def_out, &asic_out) {
        std::fs::write(p, asic::def(o)).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
    if let Some(p) = verilog {
        let mut v = output::to_verilog(&nl);
        if asic_out.is_some() || asic_models { v += &veryl_eda::pdk::verilog_models(); }
        std::fs::write(&p, v).unwrap_or_else(|e| { eprintln!("{}: {}", p, e); std::process::exit(1) });
        println!("wrote {}", p);
    }
}
