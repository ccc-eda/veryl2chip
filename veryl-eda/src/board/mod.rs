//! A virtual iCEBreaker: a fast cycle-based simulator of an iCE40 design
//! wired to the board's pins (12 MHz clock, buttons, LEDs), for the web's
//! virtual FPGA lab.
//!
//! The engine runs on a generic [`Design`]: 4-input truth tables (LUTs, and
//! carries as 3-input majorities), flip-flops, block RAMs and named IO nets.
//! It is built from the iCE40-mapped netlist ([`Design::from_netlist`]); a
//! bitstream decoder can produce the same structure. Evaluation is
//! activity driven: a changed net queues only the tables it feeds, which are
//! evaluated in level order (so values settle without glitches), and clock
//! edges are seen on any clock net (divided clocks, negative edges).

pub mod bitstream;
pub mod icebreaker;
pub mod periph;

use crate::netlist::{is_out, Bit, Dir, Netlist};
use std::collections::HashMap;

type R<T> = Result<T, String>;

/// net 0 is constant 0, net 1 constant 1
pub const C0: u32 = 0;
pub const C1: u32 = 1;

/// a combinational cell: out = table[i0 | i1 << 1 | i2 << 2 | i3 << 3]
#[derive(Clone, Debug)]
pub struct Comb { pub ins: [u32; 4], pub table: u16, pub out: u32 }

/// set / reset of a flip-flop: drives `val` while `net` is 1
#[derive(Clone, Copy, Debug)]
pub struct Ctl { pub net: u32, pub val: bool, pub sync: bool }

#[derive(Clone, Debug)]
pub struct Ff { pub d: u32, pub q: u32, pub clk: u32, pub neg: bool, pub en: Option<u32>, pub ctl: Option<Ctl> }

/// SB_RAM40_4K: 256 × 16 bits; modes 0..3 = 256×16, 512×8, 1024×4, 2048×2
#[derive(Clone, Debug)]
pub struct Ram {
    pub rclk: u32, pub rclke: u32, pub re: u32, pub raddr: [u32; 11], pub rdata: [u32; 16],
    pub wclk: u32, pub wclke: u32, pub we: u32, pub waddr: [u32; 11], pub wdata: [u32; 16], pub mask: [u32; 16],
    pub read_mode: usize, pub write_mode: usize,
    pub init: Vec<u16>,
}

/// what the engine simulates
#[derive(Clone, Debug, Default)]
pub struct Design {
    pub nets: usize,
    pub comb: Vec<Comb>,
    pub ffs: Vec<Ff>,
    pub rams: Vec<Ram>,
    /// IO by name: port bits ("o_led[3]", "i_clk") or, for a decoded bitstream, pins
    pub inputs: Vec<(String, u32)>,
    pub outputs: Vec<(String, u32)>,
}

impl Design {
    /// from an iCE40-mapped netlist (SB_LUT4, SB_CARRY, SB_DFF*, SB_RAM40_4K)
    pub fn from_netlist(nl: &Netlist) -> R<Design> {
        let mut ids: HashMap<u32, u32> = HashMap::new();
        let mut d = Design { nets: 2, ..Default::default() };
        let mut net = |b: Bit, d: &mut Design| -> u32 {
            match b {
                Bit::C0 => C0,
                Bit::C1 => C1,
                Bit::W(w) => *ids.entry(w).or_insert_with(|| { d.nets += 1; d.nets as u32 - 1 }),
            }
        };
        for c in &nl.cells {
            let p = |name: &str| c.port(name).unwrap_or(Bit::C0);
            match c.typ.as_str() {
                "SB_LUT4" => {
                    let init = c.params.iter().find(|x| x.0 == "LUT_INIT").map(|x| x.1.as_str()).unwrap_or("0");
                    let table = u16::from_str_radix(init, 2).map_err(|_| format!("bad LUT_INIT {}", init))?;
                    let ins = [net(p("I0"), &mut d), net(p("I1"), &mut d), net(p("I2"), &mut d), net(p("I3"), &mut d)];
                    let out = net(p("O"), &mut d);
                    d.comb.push(Comb { ins, table, out });
                }
                // carry out = majority(I0, I1, CI)
                "SB_CARRY" => {
                    let ins = [net(p("I0"), &mut d), net(p("I1"), &mut d), net(p("CI"), &mut d), C0];
                    let out = net(p("CO"), &mut d);
                    d.comb.push(Comb { ins, table: 0b1110_1000, out });
                }
                t if t.starts_with("SB_DFF") => {
                    // SB_DFF[N][E][S]{R,S}: active-high set / reset, S = synchronous
                    let k = &t[6..];
                    let neg = k.starts_with('N');
                    let k = k.trim_start_matches('N');
                    let has_en = k.starts_with('E');
                    let k = k.trim_start_matches('E');
                    let (sync, kind) = match k { "SR" => (true, Some(false)), "SS" => (true, Some(true)), "R" => (false, Some(false)), "S" => (false, Some(true)), "" => (false, None), o => return Err(format!("unknown flip-flop SB_DFF{}", o)) };
                    let ctl = match kind { Some(v) => Some(Ctl { net: net(p(if v { "S" } else { "R" }), &mut d), val: v, sync }), None => None };
                    let en = if has_en { Some(net(p("E"), &mut d)) } else { None };
                    let ff = Ff { d: net(p("D"), &mut d), q: net(p("Q"), &mut d), clk: net(p("C"), &mut d), neg, en, ctl };
                    d.ffs.push(ff);
                }
                "SB_RAM40_4K" => {
                    let bus = |base: &str, n: usize, d: &mut Design, net: &mut dyn FnMut(Bit, &mut Design) -> u32| -> Vec<u32> {
                        (0..n).map(|i| net(c.port(&format!("{}[{}]", base, i)).unwrap_or(Bit::C0), d)).collect()
                    };
                    let mode = |name: &str| c.params.iter().find(|x| x.0 == name).and_then(|x| usize::from_str_radix(&x.1, 2).ok()).unwrap_or(0);
                    // INIT_0..INIT_F: 16 words each, msb first
                    let mut init = vec![0u16; 256];
                    for (k, word) in init.iter_mut().enumerate() {
                        let Some(s) = c.params.iter().find(|x| x.0 == format!("INIT_{:X}", k / 16)) else { continue };
                        let s = s.1.as_bytes();
                        for b in 0..16 {
                            let bit = (k % 16) * 16 + b;
                            if s.len() == 256 && s[255 - bit] == b'1' { *word |= 1 << b; }
                        }
                    }
                    let a = |v: Vec<u32>| -> [u32; 11] { v.try_into().unwrap() };
                    let w = |v: Vec<u32>| -> [u32; 16] { v.try_into().unwrap() };
                    let ram = Ram {
                        rclk: net(p("RCLK"), &mut d), rclke: net(c.port("RCLKE").unwrap_or(Bit::C1), &mut d), re: net(c.port("RE").unwrap_or(Bit::C1), &mut d),
                        raddr: a(bus("RADDR", 11, &mut d, &mut net)), rdata: w(bus("RDATA", 16, &mut d, &mut net)),
                        wclk: net(p("WCLK"), &mut d), wclke: net(c.port("WCLKE").unwrap_or(Bit::C1), &mut d), we: net(p("WE"), &mut d),
                        waddr: a(bus("WADDR", 11, &mut d, &mut net)), wdata: w(bus("WDATA", 16, &mut d, &mut net)), mask: w(bus("MASK", 16, &mut d, &mut net)),
                        read_mode: mode("READ_MODE"), write_mode: mode("WRITE_MODE"), init,
                    };
                    d.rams.push(ram);
                }
                t => return Err(format!("the virtual board simulates iCE40 cells, not {}", t)),
            }
        }
        for port in &nl.ports {
            for (i, b) in port.bits.iter().enumerate() {
                let name = if port.bits.len() > 1 { format!("{}[{}]", port.name, i) } else { port.name.clone() };
                let n = net(*b, &mut d);
                if port.dir == Dir::In { d.inputs.push((name, n)); } else { d.outputs.push((name, n)); }
            }
        }
        // every cell output is a wire: is_out keeps the netlist's naming honest
        debug_assert!(nl.cells.iter().all(|c| c.conns.iter().any(|(p, _)| is_out(p))));
        Ok(d)
    }
}

/// The simulator. Net values are bytes; `fanout` lists the combinational
/// cells each net feeds (CSR), `level` their depth.
pub struct Engine {
    pub d: Design,
    pub v: Vec<u8>,
    level: Vec<u32>,
    fan_start: Vec<u32>,
    fan: Vec<u32>,
    queue: Vec<Vec<u32>>,
    queued: Vec<bool>,
    pending: usize,
    /// nets that clock something / drive an asynchronous set-reset
    watch: Vec<bool>,
    changed: Vec<u32>,
    clk_prev: Vec<u8>,
    /// clock nets: (rising-edge flip-flops, falling-edge flip-flops, RAMs); `clock_of[net]` indexes it (u32::MAX: not a clock)
    clocks: Vec<[Vec<u32>; 3]>,
    clock_of: Vec<u32>,
    /// flip-flops by asynchronous set/reset net: `async_of[net]` indexes `asyncs` (u32::MAX: none)
    asyncs: Vec<Vec<u32>>,
    async_of: Vec<u32>,
    mem: Vec<Vec<u16>>,
    /// flip-flop / RAM outputs computed at an edge, applied together
    next: Vec<(u32, bool)>,
    /// combinational evaluations so far (for speed figures)
    pub evals: u64,
}

impl Engine {
    pub fn new(d: Design) -> R<Engine> {
        let n = d.nets;
        // level = 1 + deepest combinational input (Kahn's algorithm); a loop leaves cells unleveled
        let mut driver = vec![u32::MAX; n];
        for (i, c) in d.comb.iter().enumerate() { driver[c.out as usize] = i as u32; }
        let mut users: Vec<Vec<u32>> = vec![vec![]; d.comb.len()];
        let mut indeg = vec![0u32; d.comb.len()];
        for (i, c) in d.comb.iter().enumerate() {
            for k in c.ins.iter().map(|x| driver[*x as usize]).filter(|k| *k != u32::MAX) {
                users[k as usize].push(i as u32);
                indeg[i] += 1;
            }
        }
        let mut level = vec![0u32; d.comb.len()];
        let mut ready: Vec<u32> = (0..d.comb.len() as u32).filter(|i| indeg[*i as usize] == 0).collect();
        let mut done = 0;
        while let Some(c) = ready.pop() {
            done += 1;
            for &u in &users[c as usize] {
                level[u as usize] = level[u as usize].max(level[c as usize] + 1);
                indeg[u as usize] -= 1;
                if indeg[u as usize] == 0 { ready.push(u); }
            }
        }
        if done != d.comb.len() { return Err("combinational loop in the design".into()); }
        let levels = level.iter().copied().max().map(|m| m as usize + 1).unwrap_or(0);
        let mut count = vec![0u32; n + 1];
        for c in &d.comb { let mut seen = [u32::MAX; 4]; for (k, i) in c.ins.iter().enumerate() { if !seen.contains(i) { count[*i as usize + 1] += 1; } seen[k] = *i; } }
        for i in 0..n { count[i + 1] += count[i]; }
        let fan_start = count.clone();
        let mut fan = vec![0u32; count[n] as usize];
        let mut fill = count;
        for (ci, c) in d.comb.iter().enumerate() {
            let mut seen = [u32::MAX; 4];
            for (k, i) in c.ins.iter().enumerate() {
                if seen.contains(i) { continue; }
                seen[k] = *i;
                fan[fill[*i as usize] as usize] = ci as u32;
                fill[*i as usize] += 1;
            }
        }
        let mut clocks: Vec<[Vec<u32>; 3]> = vec![];
        let mut clock_of = vec![u32::MAX; n];
        let mut asyncs: Vec<Vec<u32>> = vec![];
        let mut async_of = vec![u32::MAX; n];
        let mut watch = vec![false; n];
        let mut clock = |net: u32, clocks: &mut Vec<[Vec<u32>; 3]>| -> usize {
            if clock_of[net as usize] == u32::MAX { clock_of[net as usize] = clocks.len() as u32; clocks.push([vec![], vec![], vec![]]); }
            clock_of[net as usize] as usize
        };
        for (i, f) in d.ffs.iter().enumerate() {
            let k = clock(f.clk, &mut clocks);
            clocks[k][f.neg as usize].push(i as u32);
            watch[f.clk as usize] = true;
            if let Some(c) = f.ctl {
                if !c.sync {
                    if async_of[c.net as usize] == u32::MAX { async_of[c.net as usize] = asyncs.len() as u32; asyncs.push(vec![]); }
                    asyncs[async_of[c.net as usize] as usize].push(i as u32);
                    watch[c.net as usize] = true;
                }
            }
        }
        for (i, r) in d.rams.iter().enumerate() {
            for clk in [r.rclk, r.wclk] {
                let k = clock(clk, &mut clocks);
                if !clocks[k][2].contains(&(i as u32)) { clocks[k][2].push(i as u32); }
                watch[clk as usize] = true;
            }
        }
        let mem = d.rams.iter().map(|r| r.init.clone()).collect();
        let mut e = Engine {
            v: vec![0; n], level, fan_start, fan, queue: vec![vec![]; levels], queued: vec![false; d.comb.len()], pending: 0,
            watch, changed: vec![], clk_prev: vec![0; n], clocks, clock_of, asyncs, async_of, mem, evals: 0, next: vec![], d,
        };
        e.v[C1 as usize] = 1;
        e.clk_prev[C1 as usize] = 1;
        // power up: flip-flops at 0, evaluate everything once
        for c in 0..e.d.comb.len() as u32 { e.enqueue(c); }
        e.propagate();
        Ok(e)
    }

    #[inline]
    fn enqueue(&mut self, c: u32) {
        if !self.queued[c as usize] {
            self.queued[c as usize] = true;
            self.queue[self.level[c as usize] as usize].push(c);
            self.pending += 1;
        }
    }

    /// set a net (an input), without propagating
    pub fn set(&mut self, n: u32, val: bool) {
        let val = val as u8;
        if self.v[n as usize] == val { return; }
        self.v[n as usize] = val;
        if self.watch[n as usize] { self.changed.push(n); }
        let (a, b) = (self.fan_start[n as usize] as usize, self.fan_start[n as usize + 1] as usize);
        for k in a..b { let c = self.fan[k]; self.enqueue(c); }
    }

    #[inline]
    pub fn get(&self, n: u32) -> bool { self.v[n as usize] != 0 }

    /// settle combinational logic, then fire clock edges and asynchronous
    /// set/resets until nothing changes (clocks derived from logic included)
    pub fn propagate(&mut self) {
        for _round in 0..64 {
            if self.pending > 0 {
                for l in 0..self.queue.len() {
                    while let Some(c) = self.queue[l].pop() {
                        self.queued[c as usize] = false;
                        self.pending -= 1;
                        let g = &self.d.comb[c as usize];
                        let idx = self.v[g.ins[0] as usize] as u16 | (self.v[g.ins[1] as usize] as u16) << 1
                            | (self.v[g.ins[2] as usize] as u16) << 2 | (self.v[g.ins[3] as usize] as u16) << 3;
                        let out = g.out;
                        let y = (g.table >> idx) & 1 == 1;
                        self.evals += 1;
                        self.set(out, y);
                    }
                }
            }
            if self.changed.is_empty() { return; }
            let changed = std::mem::take(&mut self.changed);
            let mut next = std::mem::take(&mut self.next);
            for &n in &changed {
                let now = self.v[n as usize];
                let k = self.clock_of[n as usize];
                if k != u32::MAX && self.clk_prev[n as usize] != now {
                    self.clk_prev[n as usize] = now;
                    let rising = now == 1;
                    let edge = !rising as usize;
                    let ffs = std::mem::take(&mut self.clocks[k as usize][edge]);
                    for &i in &ffs {
                        let f = &self.d.ffs[i as usize];
                        let mut q = if f.en.map(|e| self.get(e)).unwrap_or(true) { self.get(f.d) } else { self.get(f.q) };
                        if let Some(c) = f.ctl { if self.get(c.net) { q = c.val; } }
                        next.push((f.q, q));
                    }
                    self.clocks[k as usize][edge] = ffs;
                    if rising && !self.clocks[k as usize][2].is_empty() {
                        let rams = std::mem::take(&mut self.clocks[k as usize][2]);
                        for &i in &rams { self.ram_edge(i as usize, n, &mut next); }
                        self.clocks[k as usize][2] = rams;
                    }
                }
                let a = self.async_of[n as usize];
                if a != u32::MAX && self.v[n as usize] == 1 {
                    for &i in &self.asyncs[a as usize] {
                        let f = &self.d.ffs[i as usize];
                        if let Some(c) = f.ctl { if self.get(c.net) { next.push((f.q, c.val)); } }
                    }
                }
            }
            let mut changed = changed;
            changed.clear();
            if self.changed.is_empty() { self.changed = changed; }
            if next.is_empty() && self.pending == 0 { self.next = next; return; }
            for &(n, val) in &next { self.set(n, val); }
            next.clear();
            self.next = next;
        }
    }

    /// a rising edge on `clk` for RAM `i` (yosys cells_sim.v): registered read of the old contents, then the write
    fn ram_edge(&mut self, i: usize, clk: u32, next: &mut Vec<(u32, bool)>) {
        let r = &self.d.rams[i];
        let bus = |pins: &[u32], v: &[u8]| pins.iter().enumerate().fold(0usize, |a, (k, p)| a | ((v[*p as usize] as usize) << k));
        if clk == r.rclk && self.get(r.re) && self.get(r.rclke) {
            let ra = bus(&r.raddr, &self.v);
            let rm = r.read_mode;
            let (word, lane) = (self.mem[i][ra & 0xff], (ra >> 8) & ((1 << rm) - 1));
            let mut out = [false; 16];
            for d in 0..(16 >> rm) { out[crate::bram::data_pin(rm, d)] = (word >> ((d << rm) | lane)) & 1 == 1; }
            for (k, n) in r.rdata.iter().enumerate() { if *n > C1 { next.push((*n, out[k])); } }
        }
        if clk == r.wclk && self.get(r.we) && self.get(r.wclke) {
            let (wa, wd, mask) = (bus(&r.waddr, &self.v), bus(&r.wdata, &self.v), bus(&r.mask, &self.v));
            let wm = r.write_mode;
            let cur = self.mem[i][wa & 0xff];
            self.mem[i][wa & 0xff] = if wm == 0 {
                (cur & mask as u16) | (wd as u16 & !(mask as u16))
            } else {
                let lane = (wa >> 8) & ((1 << wm) - 1);
                let mut v = cur;
                for d in 0..(16 >> wm) {
                    let b = (d << wm) | lane;
                    v = (v & !(1 << b)) | ((((wd >> crate::bram::data_pin(wm, d)) & 1) as u16) << b);
                }
                v
            };
        }
    }

    pub fn input(&self, name: &str) -> Option<u32> { self.d.inputs.iter().find(|x| x.0 == name).map(|x| x.1) }
    pub fn output(&self, name: &str) -> Option<u32> { self.d.outputs.iter().find(|x| x.0 == name).map(|x| x.1) }
}

/// The design on a board: pins (by number) bound to the design's IO through
/// a pcf, a free-running clock pin, and per-pin high-time counters (LED
/// brightness = the fraction of cycles an output was 1).
pub struct Board {
    pub eng: Engine,
    /// pin -> input net
    pub pin_in: HashMap<u32, u32>,
    /// (pin, output net, cycles high in the current window)
    pub pin_out: Vec<(u32, u32, u64)>,
    /// pin -> the design's port bit on it (from the pcf)
    pub port_of: HashMap<u32, String>,
    /// the clock pin's net, if the design uses it
    pub clk: Option<u32>,
    pub cycle: u64,
    pub window: u64,
    pub warnings: Vec<String>,
    /// per output pin (as `pin_out`): level at the last sample and edges in the window
    prev: Vec<u8>,
    edges: Vec<u64>,
    pub uart: Option<periph::Uart>,
    pub segs: Vec<periph::Seg>,
    pub vga: Option<periph::Vga>,
}

impl Board {
    /// bind `d` to the board's pins with a pcf (`set_io name pin`); `clock_pin` runs at the board clock
    pub fn new(d: Design, pcf: &str, clock_pin: u32) -> R<Board> {
        let map = crate::pnr::parse_pcf(pcf);
        let mut warnings = vec![];
        let mut pin_in = HashMap::new();
        let mut pin_out = vec![];
        let mut port_of = HashMap::new();
        for (name, n) in &d.inputs {
            match map.get(name).and_then(|p| p.parse::<u32>().ok()) {
                Some(pin) => { pin_in.insert(pin, *n); port_of.insert(pin, name.clone()); }
                None => warnings.push(format!("input {} has no pin (stays 0)", name)),
            }
        }
        for (name, n) in &d.outputs {
            match map.get(name).and_then(|p| p.parse::<u32>().ok()) {
                Some(pin) => { pin_out.push((pin, *n, 0)); port_of.insert(pin, name.clone()); }
                None => warnings.push(format!("output {} has no pin", name)),
            }
        }
        let clk = pin_in.get(&clock_pin).copied();
        if clk.is_none() { warnings.push(format!("nothing is connected to the clock pin {}", clock_pin)); }
        let eng = Engine::new(d)?;
        let n = pin_out.len();
        Ok(Board { eng, pin_in, pin_out, port_of, clk, cycle: 0, window: 0, warnings, prev: vec![0; n], edges: vec![0; n], uart: None, segs: vec![], vga: None })
    }

    /// drive an input pin (buttons, switches); pins the design does not use are ignored
    pub fn set_pin(&mut self, pin: u32, val: bool) {
        if let Some(n) = self.pin_in.get(&pin).copied() {
            if Some(n) == self.clk { return; }
            self.eng.set(n, val);
            self.eng.propagate();
        }
    }

    pub fn pin(&self, pin: u32) -> Option<bool> {
        self.pin_out.iter().find(|p| p.0 == pin).map(|p| self.eng.get(p.1)).or_else(|| self.pin_in.get(&pin).map(|n| self.eng.get(*n)))
    }

    /// the output net on a pin
    pub fn out_net(&self, pin: u32) -> Option<u32> { self.pin_out.iter().find(|p| p.0 == pin).map(|p| p.1) }

    /// the USB serial port: the FPGA's TX on `tx_pin`, its RX on `rx_pin`, `cpb` clock cycles per bit
    pub fn attach_uart(&mut self, tx_pin: u32, rx_pin: u32, cpb: f64) {
        let rx = self.pin_in.get(&rx_pin).copied();
        self.uart = Some(periph::Uart::new(self.out_net(tx_pin), rx, cpb));
    }

    /// a seven-segment display: segment pins a..g, dp; digit selects (pin, selecting level); lit level
    pub fn attach_seg(&mut self, segs: [Option<u32>; 8], sels: &[(u32, bool)], on: bool) {
        let segs = segs.map(|p| p.and_then(|p| self.out_net(p)));
        let sels: Vec<(Option<u32>, bool)> = if sels.is_empty() { vec![(None, true)] } else { sels.iter().map(|(p, l)| (self.out_net(*p), *l)).collect() };
        let n = sels.len();
        self.segs.push(periph::Seg { segs, sels, on, lit: vec![[0; 8]; n] });
    }

    /// a VGA monitor on the given pins (colors most significant first; unconnected pins are left out)
    pub fn attach_vga(&mut self, hs: u32, vs: u32, r: &[u32], g: &[u32], b: &[u32]) {
        let nets = |ps: &[u32]| ps.iter().filter_map(|p| self.out_net(*p)).collect::<Vec<u32>>();
        self.vga = Some(periph::Vga::new(self.out_net(hs), self.out_net(vs), nets(r), nets(g), nets(b)));
    }

    /// `n` board clock cycles: the serial line into the FPGA, rising edge,
    /// outputs and peripherals sampled, falling edge
    pub fn run(&mut self, n: u64) {
        let periph = self.uart.is_some() || !self.segs.is_empty() || self.vga.is_some();
        for i in 0..n {
            if let Some(u) = self.uart.as_mut() {
                if let (Some(rx), Some(l)) = (u.rx, u.rx_level(self.cycle + i)) {
                    if self.eng.v[rx as usize] != l as u8 { self.eng.set(rx, l); self.eng.propagate(); }
                }
            }
            if let Some(c) = self.clk { self.eng.set(c, true); self.eng.propagate(); }
            for (k, p) in self.pin_out.iter_mut().enumerate() {
                let v = self.eng.v[p.1 as usize];
                p.2 += v as u64;
                self.edges[k] += (v != self.prev[k]) as u64;
                self.prev[k] = v;
            }
            if periph {
                let v = &self.eng.v;
                if let Some(u) = self.uart.as_mut() { if let Some(tx) = u.tx { u.sample(v[tx as usize] != 0); } }
                for s in self.segs.iter_mut() {
                    for (d, (sel, lvl)) in s.sels.iter().enumerate() {
                        if sel.map(|n| (v[n as usize] != 0) == *lvl).unwrap_or(true) {
                            for (k, seg) in s.segs.iter().enumerate() {
                                if let Some(n) = seg { if (v[*n as usize] != 0) == s.on { s.lit[d][k] += 1; } }
                            }
                        }
                    }
                }
                if let Some(g) = self.vga.as_mut() { g.sample(v); }
            }
            if let Some(c) = self.clk { self.eng.set(c, false); self.eng.propagate(); }
        }
        self.cycle += n;
        self.window += n;
    }

    /// (pin, output level changes) since the last call: a buzzer's frequency
    pub fn take_edges(&mut self) -> Vec<(u32, u64)> {
        let r = self.pin_out.iter().zip(&self.edges).map(|(p, e)| (p.0, *e)).collect();
        for e in self.edges.iter_mut() { *e = 0; }
        r
    }

    /// per display, per digit, per segment: the fraction of the window it was lit
    pub fn take_segs(&mut self, window: u64) -> Vec<Vec<[f64; 8]>> {
        let w = window.max(1) as f64;
        self.segs.iter_mut().map(|s| {
            let r = s.lit.iter().map(|d| d.map(|c| c as f64 / w)).collect();
            for d in s.lit.iter_mut() { *d = [0; 8]; }
            r
        }).collect()
    }

    /// (pin, fraction of the window the output was 1) since the last call
    pub fn take_duty(&mut self) -> Vec<(u32, f64)> {
        let w = self.window.max(1) as f64;
        let r = self.pin_out.iter().map(|p| (p.0, p.2 as f64 / w)).collect();
        for p in self.pin_out.iter_mut() { p.2 = 0; }
        self.window = 0;
        r
    }
}
