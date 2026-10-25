//! Placement of packed LCs onto iCE40 logic tiles by simulated annealing
//! (half-perimeter wirelength). Rules of the fabric:
//! - the 8 LCs of a tile share clock, set/reset and clock polarity, so all
//!   flip-flops in one tile must agree on them;
//! - a carry chain occupies consecutive LCs of one logic column, starting
//!   at LC 0 of a tile (its carry-in is then the tile's constant CarryInSet).

use super::chipdb::Chip;
use super::pack::{Ff, Packed};
use crate::netlist::Bit;
use std::collections::HashMap;

type R<T> = Result<T, String>;

pub struct Placement {
    /// LC -> (x, y, z)
    pub lc: Vec<(i32, i32, u8)>,
    /// IO -> (x, y, pio) and package pin name
    pub io: Vec<(i32, i32, u8, String)>,
}

pub struct Rng(u64);
impl Rng {
    pub fn new(s: u64) -> Self { Rng(s | 1) }
    pub fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    pub fn below(&mut self, n: usize) -> usize { (self.next() % n as u64) as usize }
    pub fn unit(&mut self) -> f64 { (self.next() >> 11) as f64 / (1u64 << 53) as f64 }
}

#[derive(Clone, Copy)]
enum Pin { Lc(usize), Io(usize) }

const H: i32 = 30; // logic rows y = 1..=30
const PER_COL: usize = (H as usize) * 8;

pub fn place(chip: &Chip, p: &Packed, pcf: &HashMap<String, String>, globals: &[Bit], seed: u64) -> R<Placement> {
    // logic columns: every row 1..=30 is a logic tile
    let cols: Vec<i32> = (0..chip.w).filter(|x| (1..=H).all(|y| chip.tile_type.get(&(*x, y)).map(|t| t == "logic").unwrap_or(false))).collect();
    if cols.len() * PER_COL < p.lcs.len() {
        return Err(format!("design needs {} LCs, the device has {}", p.lcs.len(), cols.len() * PER_COL));
    }

    // ---- IO pins ----
    let mut used_pins: Vec<String> = vec![];
    let mut io = vec![];
    for o in &p.ios {
        let pin = match pcf.get(&o.name) {
            Some(pn) => pn.clone(),
            None => chip.pin_order.iter().find(|pn| !used_pins.contains(pn) && !pcf.values().any(|v| v == *pn))
                .ok_or("not enough package pins")?.clone(),
        };
        let &(x, y, z) = chip.pins.get(&pin).ok_or_else(|| format!("unknown package pin {} for {}", pin, o.name))?;
        if used_pins.contains(&pin) { return Err(format!("pin {} assigned twice", pin)); }
        used_pins.push(pin.clone());
        io.push((x, y, z, pin));
    }

    // ---- nets (pins by net), global nets excluded from the cost ----
    let mut net_ix: HashMap<Bit, usize> = HashMap::new();
    let mut net_pins: Vec<Vec<Pin>> = vec![];
    let add = |b: Bit, pin: Pin, net_ix: &mut HashMap<Bit, usize>, net_pins: &mut Vec<Vec<Pin>>| {
        if globals.contains(&b) || b.is_const() { return; }
        let n = *net_ix.entry(b).or_insert_with(|| { net_pins.push(vec![]); net_pins.len() - 1 });
        net_pins[n].push(pin);
    };
    for (i, lc) in p.lcs.iter().enumerate() {
        for b in lc.ins.iter().flatten() { add(*b, Pin::Lc(i), &mut net_ix, &mut net_pins); }
        if let Some(b) = lc.out { add(b, Pin::Lc(i), &mut net_ix, &mut net_pins); }
        if let Some(f) = &lc.ff { add(f.clk, Pin::Lc(i), &mut net_ix, &mut net_pins); if let Some(s) = f.sr { add(s, Pin::Lc(i), &mut net_ix, &mut net_pins); } }
    }
    for (i, o) in p.ios.iter().enumerate() { add(o.net, Pin::Io(i), &mut net_ix, &mut net_pins); }
    let mut lc_nets: Vec<Vec<usize>> = vec![vec![]; p.lcs.len()];
    for (n, pins) in net_pins.iter().enumerate() {
        for pn in pins { if let Pin::Lc(l) = pn { if !lc_nets[*l].contains(&n) { lc_nets[*l].push(n); } } }
    }

    // ---- flip-flop control sets ----
    let mut keys: Vec<Ff> = vec![];
    let key_of: Vec<Option<usize>> = p.lcs.iter().map(|lc| lc.ff.as_ref().map(|f| {
        let k = Ff { set: false, asynch: false, ..f.clone() }; // only clk / sr / polarity are tile-wide
        match keys.iter().position(|x| *x == k) { Some(i) => i, None => { keys.push(k); keys.len() - 1 } }
    })).collect();

    // ---- slots ----
    let nslot = cols.len() * PER_COL;
    let slot_xyz = |s: usize| -> (i32, i32, u8) { (cols[s / PER_COL], (s % PER_COL / 8) as i32 + 1, (s % 8) as u8) };
    let tile_of = |s: usize| s / 8;
    let mut occ: Vec<Option<usize>> = vec![None; nslot];
    let mut slot: Vec<usize> = vec![usize::MAX; p.lcs.len()];
    // per tile: (control set, number of flip-flops)
    let mut tkey: Vec<(Option<usize>, u32)> = vec![(None, 0); nslot / 8];
    let mut fixed = vec![false; p.lcs.len()];

    // carry chains first, each from LC 0 of a tile, spread over the middle columns
    let mut order: Vec<usize> = (0..p.chains.len()).collect();
    order.sort_by_key(|c| std::cmp::Reverse(p.chains[*c].lcs.len()));
    let mid = cols.len() / 2;
    let col_order: Vec<usize> = (0..cols.len()).map(|i| if i % 2 == 0 { mid + i / 2 } else { mid - 1 - i / 2 }).filter(|c| *c < cols.len()).collect();
    let mut next_col = 0;
    for c in order {
        let len = p.chains[c].lcs.len();
        if len > PER_COL { return Err(format!("carry chain of {} LCs is longer than a column", len)); }
        let mut placed = false;
        for k in 0..col_order.len() {
            let ci = col_order[(next_col + k) % col_order.len()];
            let mut start = ci * PER_COL;
            while start + len <= (ci + 1) * PER_COL {
                if (start..start + len).all(|s| occ[s].is_none()) {
                    for (j, &l) in p.chains[c].lcs.iter().enumerate() { occ[start + j] = Some(l); slot[l] = start + j; fixed[l] = true; }
                    placed = true;
                    break;
                }
                start += 8;
            }
            if placed { next_col = (next_col + k + 1) % col_order.len(); break; }
        }
        if !placed { return Err("no room for a carry chain".into()); }
    }
    // everything else: first compatible free slot, tiles in column order from the middle
    let tile_order: Vec<usize> = col_order.iter().flat_map(|&ci| (0..H as usize).map(move |y| ci * H as usize + y)).collect();
    let mut ti = 0;
    for l in 0..p.lcs.len() {
        if slot[l] != usize::MAX { continue; }
        let mut found = None;
        for k in 0..tile_order.len() {
            let t = tile_order[(ti + k) % tile_order.len()];
            if let Some(kk) = key_of[l] { if tkey[t].0.is_some() && tkey[t].0 != Some(kk) { continue; } }
            if let Some(s) = (t * 8..t * 8 + 8).find(|s| occ[*s].is_none()) { found = Some(s); ti = (ti + k) % tile_order.len(); break; }
        }
        let s = found.ok_or("placement: no legal slot left")?;
        occ[s] = Some(l);
        slot[l] = s;
        if let Some(kk) = key_of[l] { let t = tile_of(s); tkey[t] = (Some(kk), tkey[t].1 + 1); }
    }

    // ---- annealing ----
    let pos = |pn: &Pin, slot: &Vec<usize>| -> (i32, i32) {
        match pn { Pin::Lc(l) => { let (x, y, _) = slot_xyz(slot[*l]); (x, y) } Pin::Io(i) => (io[*i].0, io[*i].1) }
    };
    let hpwl = |n: usize, slot: &Vec<usize>| -> f64 {
        let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for pn in &net_pins[n] { let (x, y) = pos(pn, slot); x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
        if x0 == i32::MAX { 0.0 } else { ((x1 - x0) + (y1 - y0)) as f64 }
    };
    let mut ncost: Vec<f64> = (0..net_pins.len()).map(|n| hpwl(n, &slot)).collect();
    let mut cost: f64 = ncost.iter().sum();
    let movable: Vec<usize> = (0..p.lcs.len()).filter(|l| !fixed[*l]).collect();
    if movable.is_empty() || net_pins.is_empty() {
        return Ok(Placement { lc: slot.iter().map(|s| slot_xyz(*s)).collect(), io });
    }
    let mut rng = Rng::new(seed);
    let ncols = cols.len() as i32;
    let mut rlim = ncols.max(H) as f64;
    let mut temp = {
        // initial temperature from random moves
        let mut d = vec![];
        for _ in 0..200 {
            let l = movable[rng.below(movable.len())];
            let mut delta = 0.0;
            for &n in &lc_nets[l] { delta += ncost[n]; }
            d.push(delta);
        }
        let m = d.iter().sum::<f64>() / d.len() as f64;
        (d.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / d.len() as f64).sqrt().max(1.0) * 2.0
    };
    let moves_per_t = (movable.len() as f64).powf(1.33) as usize * 4 + 100;
    let mut touched: Vec<usize> = vec![];
    let mut stamp = vec![0u32; net_pins.len()];
    let mut gen = 0u32;
    loop {
        let mut accepted = 0usize;
        for _ in 0..moves_per_t {
            let a = movable[rng.below(movable.len())];
            let sa = slot[a];
            let (ax, ay, _) = slot_xyz(sa);
            let ci = cols.iter().position(|x| *x == ax).unwrap() as i32;
            let r = rlim.max(1.0) as i32;
            let nci = (ci + rng.below((2 * r + 1) as usize) as i32 - r).clamp(0, ncols - 1);
            let ny = (ay + rng.below((2 * r + 1) as usize) as i32 - r).clamp(1, H);
            let sb = nci as usize * PER_COL + (ny as usize - 1) * 8 + rng.below(8);
            if sb == sa { continue; }
            let b = occ[sb];
            if let Some(b) = b { if fixed[b] { continue; } }
            // control-set legality after the swap
            let (ta, tb) = (tile_of(sa), tile_of(sb));
            if ta != tb {
                let ka = key_of[a];
                let kb = b.and_then(|b| key_of[b]);
                let ok = |t: usize, out: Option<usize>, inn: Option<usize>, tkey: &Vec<(Option<usize>, u32)>| -> bool {
                    let Some(k) = inn else { return true };
                    let (cur, cnt) = tkey[t];
                    let cnt = cnt - out.is_some() as u32;
                    cnt == 0 || cur == Some(k)
                };
                if !ok(tb, kb, ka, &tkey) || !ok(ta, ka, kb, &tkey) { continue; }
            }
            // apply
            occ[sb] = Some(a);
            occ[sa] = b;
            slot[a] = sb;
            if let Some(b) = b { slot[b] = sa; }
            gen += 1;
            touched.clear();
            for &n in lc_nets[a].iter().chain(b.map(|b| lc_nets[b].as_slice()).unwrap_or(&[])) {
                if stamp[n] != gen { stamp[n] = gen; touched.push(n); }
            }
            let mut delta = 0.0;
            let newc: Vec<f64> = touched.iter().map(|&n| { let c = hpwl(n, &slot); delta += c - ncost[n]; c }).collect();
            if delta <= 0.0 || rng.unit() < (-delta / temp).exp() {
                for (i, &n) in touched.iter().enumerate() { ncost[n] = newc[i]; }
                cost += delta;
                accepted += 1;
                if ta != tb {
                    let kb = b.and_then(|b| key_of[b]);
                    let ka = key_of[a];
                    if ka.is_some() { tkey[ta].1 -= 1; tkey[tb].1 += 1; tkey[tb].0 = ka; }
                    if kb.is_some() { tkey[tb].1 -= 1; tkey[ta].1 += 1; tkey[ta].0 = kb; }
                    for t in [ta, tb] { if tkey[t].1 == 0 { tkey[t].0 = None; } }
                }
            } else {
                occ[sa] = Some(a);
                occ[sb] = b;
                slot[a] = sa;
                if let Some(b) = b { slot[b] = sb; }
            }
        }
        let rate = accepted as f64 / moves_per_t as f64;
        temp *= if rate > 0.96 { 0.5 } else if rate > 0.8 { 0.9 } else if rate > 0.15 { 0.95 } else { 0.8 };
        rlim = (rlim * (1.0 - 0.44 + rate)).clamp(1.0, ncols.max(H) as f64);
        if temp < 0.005 * cost.max(1.0) / net_pins.len() as f64 { break; }
    }
    Ok(Placement { lc: slot.iter().map(|s| slot_xyz(*s)).collect(), io })
}
