//! Place and route for Lattice iCE40 (UP5K), on the IceStorm chip database:
//! pack (LUT/carry/FF -> logic cells), place (simulated annealing), route
//! (PathFinder), and write the `.asc` configuration that icepack turns into
//! a bitstream.

pub mod bitstream;
pub mod chipdb;
pub mod pack;
pub mod place;
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
}

impl<'c> Asc<'c> {
    fn new(chip: &'c Chip) -> Self {
        let mut bits = HashMap::new();
        for (xy, t) in &chip.tiles {
            let (c, r) = chip.dims[t];
            bits.insert(*xy, vec![vec![b'0'; c]; r]);
        }
        Asc { chip, bits, groups: HashMap::new() }
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
        s
    }
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

    let pl = place::place(&chip, &p, &o.pcf, &globals, o.seed)?;

    // ---- routing problem ----
    let w = |x: i32, y: i32, s: &str| chip.net(x, y, s).ok_or_else(|| format!("no wire {} at {},{}", s, x, y));
    let mut src: HashMap<Bit, u32> = HashMap::new();
    let mut sinks: HashMap<Bit, Vec<u32>> = HashMap::new();
    let mut gsinks: HashMap<Bit, Vec<u32>> = HashMap::new();
    let mut names: HashMap<Bit, String> = HashMap::new();
    for (n, bits) in &nl.nets {
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
    for (i, io) in p.ios.iter().enumerate() {
        let (x, y, z, _) = &pl.io[i];
        names.insert(io.net, io.name.clone());
        match io.dir {
            Dir::In => { let ww = w(*x, *y, &format!("io_{}/D_IN_0", z))?; src.insert(io.net, ww); eps.insert(ww, sta::Ep::IoIn(i)); }
            Dir::Out => { let ww = w(*x, *y, &format!("io_{}/D_OUT_0", z))?; sinks.entry(io.net).or_default().push(ww); eps.insert(ww, sta::Ep::IoOut(i)); }
        }
    }
    let mut nets = vec![];
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
        nets.push(route::RNet { name, src: src[&b], sinks: all, global });
    }
    if let Some((b, _)) = sinks.iter().find(|(_, v)| !v.is_empty()) { return Err(format!("net {:?} has loads but no driver", b)); }
    let extra: Vec<(u32, u32)> = chip.gbufin.iter().map(|&(x, y, g)| Ok((w(x, y, "fabout")?, w(x, y, &format!("glb_netwk_{}", g))?))).collect::<R<_>>()?;
    let (routes, route_iters) = route::route(&chip, &nets, &extra, o.verbose)?;
    let timing = sta::analyze(chip, &p, &pl, &nets, &routes, &eps, extra.len());

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
    Ok(Output { asc: a.text(), pcf, lcs: p.lcs.len(), wires, extra: extra.len(), packed: p, placement: pl, nets, routes, route_iters, timing, globals: gl })
}
