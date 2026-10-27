//! veryl-emu [--top MODULE] [--stop SIGNAL]... [-o OUT.wasm] FILE.veryl...
//! writes OUT.wasm and OUT.json (signal offsets for the harness)
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut top, mut out, mut stops, mut files) = (None, "emu.wasm".to_string(), vec![], vec![]);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--top" => { i += 1; top = args.get(i).cloned(); }
            "--stop" => { i += 1; if let Some(s) = args.get(i) { stops.extend(s.split(',').map(|x| x.to_string())); } }
            "-o" => { i += 1; if let Some(o) = args.get(i) { out = o.clone(); } }
            "-h" | "--help" => { println!("usage: veryl-emu [--top MODULE] [--stop SIGNAL,...] [-o OUT.wasm] FILE.veryl..."); return; }
            f => files.push(f.to_string()),
        }
        i += 1;
    }
    if files.is_empty() { eprintln!("usage: veryl-emu [--top MODULE] [--stop SIGNAL,...] [-o OUT.wasm] FILE.veryl..."); std::process::exit(2); }
    let srcs: Vec<(String, String)> = files.iter().map(|f| (f.clone(), std::fs::read_to_string(f).unwrap_or_else(|e| { eprintln!("{}: {}", f, e); std::process::exit(2) }))).collect();
    let t0 = std::time::Instant::now();
    match veryl_emu::compile(&srcs, top.as_deref(), &stops) {
        Ok(o) => {
            std::fs::write(&out, &o.wasm).unwrap();
            let json = out.strip_suffix(".wasm").unwrap_or(&out).to_string() + ".json";
            std::fs::write(&json, &o.json).unwrap();
            eprintln!("{}\nwrote {} ({} KB) and {} in {:.1}s", o.stats, out, o.wasm.len() / 1024, json, t0.elapsed().as_secs_f64());
        }
        Err(e) => { eprintln!("{}", e); std::process::exit(1); }
    }
}
