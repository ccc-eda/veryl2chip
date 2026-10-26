//! Place and route for Lattice iCE40 (UP5K), on the IceStorm chip database:
//! pack (LUT/carry/FF -> logic cells), place (simulated annealing), route
//! (PathFinder), and write the `.asc` configuration that icepack turns into
//! a bitstream.

pub mod bitstream;
pub mod chipdb;
pub mod pack;
pub mod place;
pub mod power;
pub mod route;
pub mod sta;

use crate::netlist::{Bit, Dir, Netlist};
use chipdb::Chip;
use std::collections::HashMap;

type R<T> = Result<T, String>;

pub struct Opts {
    pub chipdb: Option<String>,
    pub package: String,
    pub pcf: HashMap<String, String>,
    pub seed: u64,
    pub verbose: bool,
    /// second, timing-driven placement and routing pass
    pub timing_driven: bool,
}

pub struct Output {
    pub asc: String,
    /// pin assignment actually used (pcf syntax)
    pub pcf: String,
    pub lcs: usize,
    pub wires: usize,
    pub packed: pack::Packed,
    pub placement: place::Placement,
    pub nets: Vec<route::RNet>,
    pub routes: Vec<Vec<u32>>,
    /// overused wires after each routing iteration
    pub route_iters: Vec<usize>,
    /// number of hardwired fabout -> global pseudo pips (indices u32::MAX - i)
    pub extra: usize,
    pub timing: sta::Timing,
    /// global networks used: (net name, network number)
    pub globals: Vec<(String, u8)>,
    /// Fmax of the wirelength-only pass (when the timing-driven pass ran)
    pub fmax_wl: Option<f64>,
    pub power: power::FpgaPower,
}

/// LUT_INIT bit k sits at LC config bit LUT_PERM[k]; 8 = carry enable,
/// 9 = flip-flop enable, 18 = set (vs reset) value, 19 = asynchronous set/reset
const LUT_PERM: [usize; 16] = [4, 14, 15, 5, 6, 16, 17, 7, 3, 13, 12, 2, 1, 11, 10, 0];

pub fn parse_pcf(text: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for l in text.lines() {
        let p: Vec<&str> = l.split('#').next().unwrap_or("").split_whitespace().collect();
        if p.len() >= 3 && p[0] == "set_io" {
            let args: Vec<&&str> = p[1..].iter().filter(|a| !a.starts_with('-')).collect();
            if args.len() >= 2 { m.insert(args[0].to_string(), args[1].to_string()); }
        }
    }
    m
}

struct Asc<'c> {
    chip: &'c Chip,
    bits: HashMap<(i32, i32), Vec<Vec<u8>>>,
    groups: HashMap<u32, u32>,
    /// block RAM contents: ramb tile -> 16 lines of 64 hex digits
    ram_data: Vec<((i32, i32), Vec<String>)>,
}

impl<'c> Asc<'c> {
    fn new(chip: &'c Chip) -> Self {
        let mut bits = HashMap::new();
        for (xy, t) in &chip.tiles {
            let (c, r) = chip.dims[t];
            bits.insert(*xy, vec![vec![b'0'; c]; r]);
        }
        Asc { chip, bits, groups: HashMap::new(), ram_data: vec![] }
    }
    fn set(&mut self, x: i32, y: i32, (r, c): (u8, u8), v: bool) {
        self.bits.get_mut(&(x, y)).unwrap()[r as usize][c as usize] = if v { b'1' } else { b'0' };
    }
    fn func(&mut self, x: i32, y: i32, f: &str) -> R<()> {
        let t = self.chip.tile_type[&(x, y)].clone();
        for b in self.chip.bits(&t, f)?.clone() { self.set(x, y, b, true); }
        Ok(())
    }
    fn pip(&mut self, p: u32) -> R<()> {
        let pip = &self.chip.pips[p as usize];
        if let Some(&old) = self.groups.get(&pip.group) {
            if old != pip.pat { return Err(format!("conflicting settings for the input mux of {}", self.chip.label(pip.dst))); }
            return Ok(());
        }
        self.groups.insert(pip.group, pip.pat);
        for (i, b) in self.chip.groups[pip.group as usize].clone().into_iter().enumerate() {
            self.set(pip.x as i32, pip.y as i32, b, (pip.pat >> i) & 1 == 1);
        }
        Ok(())
    }
    fn text(&self) -> String {
        let mut s = String::from(".comment from veryl-eda\n.device 5k\n");
        for (xy, t) in &self.chip.tiles {
            s += &format!(".{}_tile {} {}\n", t, xy.0, xy.1);
            for row in &self.bits[xy] { s += std::str::from_utf8(row).unwrap(); s.push('\n'); }
        }
        for ((x, y), lines) in &self.ram_data {
            s += &format!(".ram_data {} {}\n", x, y);
            for l in lines { s += l; s.push('\n'); }
        }
        s
    }
}

/// where a memory block ended up: `bram::SLOT` (NAME:BLOCK), tile and mode
#[derive(Clone, Debug, PartialEq)]
pub struct RamPos { pub slot: String, pub x: i32, pub y: i32, pub mode: usize }

impl Output {
    /// the placed block RAMs that hold (blocks of) named memories
    pub fn ram_map(&self) -> Vec<RamPos> {
        self.packed.rams.iter().enumerate().filter_map(|(r, ram)| {
            let (x, y) = self.placement.ram[r];
            Some(RamPos { slot: ram.slot.clone()?, x, y, mode: ram.read_mode as usize })
        }).collect()
    }
}

/// the `.ram_data` lines of a block (16 rows of 64 hex digits)
fn ram_lines(init: &[String]) -> Vec<String> {
    init.iter().map(|bits| {
        bits.as_bytes().chunks(4).map(|c| { let v = c.iter().fold(0u32, |a, b| a * 2 + (*b == b'1') as u32); std::char::from_digit(v, 16).unwrap() }).collect::<String>()
    }).collect()
}

/// Put new contents into memory `name` of a placed-and-routed design without
/// placing and routing it again: rewrite the `.ram_data` of its blocks in the .asc
/// (`map` from `Output::ram_map`). Returns the new .asc and the number of blocks.
pub fn patch_ram(asc: &str, map: &[RamPos], name: &str, words: &[u64]) -> R<(String, usize)> {
    let mut blocks: HashMap<(i32, i32), Vec<String>> = HashMap::new();
    for r in map {
        let Some((m, k)) = r.slot.rsplit_once(':') else { continue };
        if m != name { continue; }
        let k: usize = k.parse().map_err(|_| format!("bad memory slot {}", r.slot))?;
        blocks.insert((r.x, r.y), ram_lines(&crate::bram::init_strings(r.mode, k, words)));
    }
    if blocks.is_empty() { return Err(format!("no block RAM holds memory {}", name)); }
    let n = blocks.len();
    let mut out = String::with_capacity(asc.len());
    let mut lines = asc.lines().peekable();
    while let Some(l) = lines.next() {
        out += l;
        out.push('\n');
        let mut p = l.split_whitespace();
        if p.next() == Some(".ram_data") {
            let xy = (p.next().and_then(|v| v.parse().ok()), p.next().and_then(|v| v.parse().ok()));
            if let (Some(x), Some(y)) = xy {
                if let Some(new) = blocks.remove(&(x, y)) {
                    // replace the 16 rows that follow
                    for _ in 0..16 { if lines.peek().is_some_and(|r| !r.starts_with('.')) { lines.next(); } }
                    for r in new { out += &r; out.push('\n'); }
                }
            }
        }
    }
    // blocks the .asc had no contents for yet
    for ((x, y), rows) in blocks {
        out += &format!(".ram_data {} {}\n", x, y);
        for r in rows { out += &r; out.push('\n'); }
    }
    Ok((out, n))
}

fn find_pip(chip: &Chip, x: i32, y: i32, dst: &str, src: &str) -> R<u32> {
    let (d, s) = (chip.net(x, y, dst).ok_or_else(|| format!("no wire {} at {},{}", dst, x, y))?, chip.net(x, y, src).ok_or_else(|| format!("no wire {} at {},{}", src, x, y))?);
    chip.fanout[s as usize].iter().copied().find(|p| { let q = &chip.pips[*p as usize]; q.dst == d && q.x as i32 == x && q.y as i32 == y })
        .ok_or_else(|| format!("no pip {} <- {} at {},{}", dst, src, x, y))
}

pub fn place_and_route(nl: &Netlist, o: &Opts) -> R<Output> {
    let path = o.chipdb.clone().or_else(chipdb::default_path).ok_or("IceStorm chipdb-5k.txt not found (set VERYL_EDA_CHIPDB)")?;
    let chip = Chip::load(&path, &o.package)?;
    place_and_route_on(&chip, nl, o)
}

/// place and route on an already loaded chip database
pub fn place_and_route_on(chip: &Chip, nl: &Netlist, o: &Opts) -> R<Output> {
    let chip = chip;
    let p = pack::pack(nl)?;
    if o.verbose { eprintln!("  packed: {} LCs, {} carry chains, {} IOs", p.lcs.len(), p.chains.len(), p.ios.len()); }

    // ---- global networks: set/reset nets need an even one ----
    let mut clocks: Vec<Bit> = vec![];
    let mut resets: Vec<Bit> = vec![];
    for r in &p.rams {
        for (pin, b) in &r.ins { if (pin == "RCLK" || pin == "WCLK") && !clocks.contains(b) { clocks.push(*b); } }
    }
    for lc in &p.lcs {
        if let Some(f) = &lc.ff {
            if !clocks.contains(&f.clk) { clocks.push(f.clk); }
            if let Some(s) = f.sr { if !resets.contains(&s) && !clocks.contains(&s) { resets.push(s); } }
        }
    }
    let mut free: Vec<(i32, i32, u8)> = chip.gbufin.clone();
    let mut global_of: HashMap<Bit, (i32, i32, u8)> = HashMap::new();
    for (list, even) in [(&resets, true), (&clocks, false)] {
        for b in list.iter() {
            let i = free.iter().position(|g| !even || g.2 % 2 == 0).ok_or("out of global networks")?;
            global_of.insert(*b, free.remove(i));
        }
    }
    let globals: Vec<Bit> = global_of.keys().copied().collect();

    let w = |x: i32, y: i32, s: &str| chip.net(x, y, s).ok_or_else(|| format!("no wire {} at {},{}", s, x, y));
    // ---- routing problem for a placement: nets (with their signal bits), endpoints, names ----
    let build = |pl: &place::Placement| -> R<(Vec<route::RNet>, Vec<Bit>, HashMap<u32, sta::Ep>, HashMap<Bit, String>)> {

        // ---- routing problem ----
        let w = |x: i32, y: i32, s: &str| chip.net(x, y, s).ok_or_else(|| format!("no wire {} at {},{}", s, x, y));
        let mut src: HashMap<Bit, u32> = HashMap::new();
        let mut sinks: HashMap<Bit, Vec<u32>> = HashMap::new();
        let mut gsinks: HashMap<Bit, Vec<u32>> = HashMap::new();
        let mut names: HashMap<Bit, String> = HashMap::new();
        for (n, bits) in nl.nets.iter().filter(|(n, _)| !n.starts_with("$mem:")) {
            for (i, b) in bits.iter().enumerate() {
                names.entry(*b).or_insert_with(|| if bits.len() > 1 { format!("{}[{}]", n, i) } else { n.clone() });
            }
        }
        let mut eps: HashMap<u32, sta::Ep> = HashMap::new();
        for (i, lc) in p.lcs.iter().enumerate() {
            let (x, y, z) = pl.lc[i];
            if let Some(b) = lc.out {
                let ww = w(x, y, &format!("lutff_{}/out", z))?;
                src.insert(b, ww);
                eps.insert(ww, sta::Ep::LcOut(i));
            }
            for k in 0..4 {
                if let Some(b) = lc.ins[k] {
                    let ww = w(x, y, &format!("lutff_{}/in_{}", z, k))?;
                    sinks.entry(b).or_default().push(ww);
                    eps.insert(ww, sta::Ep::LcIn(i, k as u8));
                }
            }
            if let Some(f) = &lc.ff {
                for (b, pin) in std::iter::once((f.clk, "lutff_global/clk")).chain(f.sr.map(|s| (s, "lutff_global/s_r"))) {
                    let s = w(x, y, pin)?;
                    let list = if global_of.contains_key(&b) { gsinks.entry(b).or_default() } else { sinks.entry(b).or_default() };
                    if !list.contains(&s) { list.push(s); }
                }
            }
        }
        // block RAM pins live in the ramb tile or the ramt tile above it
        let ram_wire = |x: i32, y: i32, pin: &str| -> R<u32> {
            let n = format!("ram/{}", pin);
            chip.net(x, y, &n).or_else(|| chip.net(x, y + 1, &n)).ok_or_else(|| format!("no RAM pin {} at {},{}", pin, x, y))
        };
        for (r, ram) in p.rams.iter().enumerate() {
            let (x, y) = pl.ram[r];
            for (pin, b) in &ram.outs { let ww = ram_wire(x, y, pin)?; src.insert(*b, ww); eps.insert(ww, sta::Ep::RamOut(r)); }
            for (pin, b) in &ram.ins {
                let ww = ram_wire(x, y, pin)?;
                let list = if global_of.contains_key(b) { gsinks.entry(*b).or_default() } else { sinks.entry(*b).or_default() };
                if !list.contains(&ww) { list.push(ww); }
                if pin != "RCLK" && pin != "WCLK" { eps.insert(ww, sta::Ep::RamIn(r, sta::ram_setup(pin))); }
            }
        }
        for (i, io) in p.ios.iter().enumerate() {
            let (x, y, z, _) = &pl.io[i];
            names.insert(io.net, io.name.clone());
            match io.dir {
                Dir::In => { let ww = w(*x, *y, &format!("io_{}/D_IN_0", z))?; src.insert(io.net, ww); eps.insert(ww, sta::Ep::IoIn(i)); }
                Dir::Out => { let ww = w(*x, *y, &format!("io_{}/D_OUT_0", z))?; sinks.entry(io.net).or_default().push(ww); eps.insert(ww, sta::Ep::IoOut(i)); }
            }
        }
        let mut nets = vec![];
        let mut bits: Vec<Bit> = vec![];
        let mut keys: Vec<Bit> = src.keys().copied().collect();
        keys.sort();
        for b in keys {
            let s = sinks.remove(&b).unwrap_or_default();
            let g = gsinks.remove(&b).unwrap_or_default();
            if s.is_empty() && g.is_empty() { continue; }
            let global = match global_of.get(&b) {
                Some(&(gx, gy, gi)) => Some((w(gx, gy, "fabout")?, w(gx, gy, &format!("glb_netwk_{}", gi))?, g.clone())),
                None => None,
            };
            let mut all = s;
            all.extend(g);
            let name = names.get(&b).cloned().unwrap_or_else(|| match b { Bit::W(w) => format!("n{}", w), _ => format!("{:?}", b) });
            nets.push(route::RNet { name, src: src[&b], sinks: all, global, crit: 0.0 });
            bits.push(b);
        }
        if let Some((b, _)) = sinks.iter().find(|(_, v)| !v.is_empty()) { return Err(format!("net {:?} has loads but no driver", b)); }
        Ok((nets, bits, eps, names))
    };
    let extra: Vec<(u32, u32)> = chip.gbufin.iter().map(|&(x, y, g)| Ok((w(x, y, "fabout")?, w(x, y, &format!("glb_netwk_{}", g))?))).collect::<R<_>>()?;

    // pass 1: wirelength-driven placement and routing
    let mut pl = place::place(chip, &p, &o.pcf, &globals, o.seed, &HashMap::new())?;
    let (mut nets, mut bits, mut eps, mut names) = build(&pl)?;
    let (mut routes, mut route_iters) = route::route(chip, &nets, &extra, o.verbose)?;
    let mut timing = sta::analyze(chip, &p, &pl, &nets, &routes, &eps, extra.len());
    // pass 2 (timing-driven): nets weighted by their criticality in pass 1, both
    // in the placement cost and in the router; the faster result is kept
    let mut fmax_wl = None;
    if o.timing_driven && !nets.is_empty() {
        let crit: HashMap<Bit, f32> = bits.iter().zip(&timing.net_crit).map(|(b, c)| (*b, *c)).collect();
        let sinks: HashMap<Bit, usize> = bits.iter().zip(&nets).map(|(b, n)| (*b, n.sinks.len())).collect();
        // only near-critical nets get heavier, high-fanout ones less so
        let weights: HashMap<Bit, f64> = crit.iter().map(|(b, c)| (*b, 1.0 + 6.0 * (*c as f64).powi(8) / (sinks.get(b).copied().unwrap_or(1).max(1) as f64).sqrt())).collect();
        let pl2 = place::place(chip, &p, &o.pcf, &globals, o.seed, &weights)?;
        let (mut nets2, bits2, eps2, names2) = build(&pl2)?;
        for (n, b) in nets2.iter_mut().zip(&bits2) { n.crit = crit.get(b).copied().unwrap_or(0.0); }
        fmax_wl = Some(timing.fmax);
        // a pass that does not route keeps the first result
        if let Ok((routes2, iters2)) = route::route(chip, &nets2, &extra, o.verbose) {
            let timing2 = sta::analyze(chip, &p, &pl2, &nets2, &routes2, &eps2, extra.len());
            if o.verbose { eprintln!("  timing-driven pass: {:.2} -> {:.2} MHz", timing.fmax, timing2.fmax); }
            // the analysis is an estimate: a gain within its error is not worth it
            if timing2.fmax > timing.fmax * 1.03 {
                pl = pl2; nets = nets2; bits = bits2; eps = eps2; names = names2; routes = routes2; route_iters = iters2; timing = timing2;
            }
        }
    }
    let _ = &eps;
    // power at Fmax, from a random-input simulation of the mapped netlist
    let act = crate::power::activity(nl, (2_000_000 / nl.cells.len().max(1)).clamp(100, 1000), 1);
    let power = power::estimate(nl, &nets, &bits, &routes, extra.len(), &act, timing.fmax);

    // ---- configuration ----
    let mut a = Asc::new(&chip);
    let mut wires = 0;
    for r in &routes {
        for &pp in r {
            if pp >= u32::MAX - extra.len() as u32 { continue; } // hardwired fabout -> global
            a.pip(pp)?;
            wires += 1;
        }
    }
    let mut negclk: HashMap<(i32, i32), bool> = HashMap::new();
    for (i, lc) in p.lcs.iter().enumerate() {
        let (x, y, z) = pl.lc[i];
        let mut v = [false; 20];
        for k in 0..16 { v[LUT_PERM[k]] = (lc.init >> k) & 1 == 1; }
        v[8] = lc.carry;
        if let Some(f) = &lc.ff {
            v[9] = true;
            v[18] = f.set;
            v[19] = f.asynch && f.sr.is_some();
            if let Some(old) = negclk.insert((x, y), f.neg) { if old != f.neg { return Err("mixed clock polarity in a tile".into()); } }
        }
        let bits = chip.bits("logic", &format!("LC_{}", z))?.clone();
        for (k, b) in bits.into_iter().enumerate() { if v[k] { a.set(x, y, b, true); } }
    }
    for ((x, y), neg) in negclk { if neg { a.func(x, y, "NegClk")?; } }
    // block RAMs: power up, read / write modes, contents
    for (r, ram) in p.rams.iter().enumerate() {
        let (x, y) = pl.ram[r];
        a.func(x, y, "RamConfig.PowerUp")?;
        for (k, on) in [ram.write_mode & 1, ram.write_mode & 2, ram.read_mode & 1, ram.read_mode & 2].iter().enumerate() {
            if *on != 0 { a.func(x, y + 1, &format!("RamConfig.CBIT_{}", k))?; }
        }
        a.ram_data.push(((x, y), ram_lines(&ram.init)));
    }
    for ch in &p.chains {
        for (j, &l) in ch.lcs.iter().enumerate() {
            let (x, y, z) = pl.lc[l];
            if j == 0 {
                if z != 0 { return Err("carry chain does not start at LC 0".into()); }
                if ch.cin { a.func(x, y, "CarryInSet")?; }
            } else if z == 0 {
                a.pip(find_pip(&chip, x, y, "carry_in_mux", "carry_in")?)?;
            }
            if p.lcs[l].in3_chain {
                let from = if z == 0 { "carry_in_mux".to_string() } else { format!("lutff_{}/cout", z - 1) };
                a.pip(find_pip(&chip, x, y, &format!("lutff_{}/in_3", z), &from)?)?;
            }
        }
    }
    // IO cells
    let mut pcf = String::new();
    for (i, io) in p.ios.iter().enumerate() {
        let (x, y, z, pin) = &pl.io[i];
        pcf += &format!("set_io {} {}\n", io.name, pin);
        let types: &[usize] = if io.dir == Dir::In { &[0] } else { &[0, 3, 4] };
        for t in types { a.func(*x, *y, &format!("IOB_{}.PINTYPE_{}", z, t))?; }
        let &(ix, iy, iz) = chip.ieren.get(&(*x, *y, *z)).ok_or("no IE/REN for pin")?;
        if io.dir == Dir::In { a.func(ix, iy, &format!("IoCtrl.IE_{}", iz))?; }
        a.func(ix, iy, &format!("IoCtrl.REN_{}", iz))?;
        a.func(*x, *y, if *z == 0 { "IoCtrl.cf_bit_35" } else { "IoCtrl.cf_bit_39" })?;
    }
    // column buffers on for every global, and the default cascade bits of the
    // DSP / IP-connect tiles (as nextpnr writes them; UP5K tile 25,14 excepted)
    for &(x, y) in &chip.colbuf_src {
        for g in 0..8 { a.func(x, y, &format!("ColBufCtrl.glb_netwk_{}", g))?; }
    }
    for (xy, t) in &chip.tiles {
        if !(t.starts_with("dsp") || t == "ipcon") || *xy == (25, 14) { continue; }
        let fs: Vec<String> = chip.tile_bits[t].keys().filter(|f| f.starts_with("Cascade.") && f.ends_with("_inmux02_5")).cloned().collect();
        for f in fs { a.func(xy.0, xy.1, &f)?; }
    }
    let mut gl: Vec<(String, u8)> = global_of.iter().map(|(b, g)| (names.get(b).cloned().unwrap_or_else(|| match b { Bit::W(w) => format!("n{}", w), _ => format!("{:?}", b) }), g.2)).collect();
    gl.sort();
    Ok(Output { asc: a.text(), pcf, lcs: p.lcs.len(), wires, extra: extra.len(), packed: p, placement: pl, nets, routes, route_iters, timing, globals: gl, fmax_wl, power })
}
