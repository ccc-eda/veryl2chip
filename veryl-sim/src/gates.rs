//! Gate-level models for post-synthesis simulation: a testbench instantiates
//! a module as usual, but if a gate netlist was given for that module the
//! simulator builds the netlist instead of the RTL. Every wire becomes a
//! 1-bit signal; combinational cells become continuous assignments,
//! flip-flops `always_ff` processes, RAMs arrays with synchronous ports.
//!
//! Cells: yosys internal gates ($_NOT_ $_AND_ $_OR_ $_XOR_ $_MUX_, $_DFF_*,
//! $_SDFF_*), iCE40 (SB_LUT4 SB_CARRY SB_DFF* SB_RAM40_4K), ECP5 (LUT4 CCU2C
//! TRELLIS_FF) and the vlib standard cells of veryl-eda (INV ... DFFNS, SRAM macros).

use crate::elab::{Dir, Elab, Scope};
use crate::expr::{Expr, LValue, Sel};
use crate::sim::*;
use crate::value::*;
use std::collections::HashMap;

/// Gives the gate netlist of a module for the given parameter overrides,
/// or None to simulate that module's RTL.
pub type GateFn<'a> = dyn Fn(&str, &HashMap<String, Val>) -> Result<Option<GateNetlist>, String> + 'a;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Pin { C0, C1, W(u32) }

#[derive(Clone, Debug)]
pub struct GCell {
    pub typ: String,
    /// (pin, net); bus pins are named "NAME[i]"
    pub conns: Vec<(String, Pin)>,
    pub params: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub struct GPort { pub name: String, pub output: bool, pub bits: Vec<Pin> }

#[derive(Clone, Debug, Default)]
pub struct GateNetlist { pub ports: Vec<GPort>, pub cells: Vec<GCell> }

type R<T> = Result<T, String>;

fn bin(op: &str, a: Expr, b: Expr) -> Expr { Expr::Bin(op.into(), Box::new(a), Box::new(b)) }
fn not(a: Expr) -> Expr { Expr::Un("~".into(), Box::new(a)) }
fn lv(sig: usize) -> LValue { LValue { sig, sel: Sel::All } }

impl<'a> Elab<'a> {
    /// build gate netlist `g` as the instance with hierarchical `prefix`
    pub fn elab_gates(&mut self, g: &GateNetlist, prefix: &str) -> R<Scope> {
        let mut sc = Scope { prefix: prefix.to_string(), ..Default::default() };
        let mut wires: HashMap<u32, usize> = HashMap::new();
        let sig_of = |e: &Expr| -> usize { if let Expr::Sig(i) = e { *i } else { usize::MAX } };
        // ports: full-width signals, connected bit by bit to the wires
        for p in &g.ports {
            let full = if prefix.is_empty() { p.name.clone() } else { format!("{}.{}", prefix, p.name) };
            let id = self.new_sig(full, p.bits.len().max(1) as u32);
            sc.sigs.insert(p.name.clone(), id);
            sc.ports.push((p.name.clone(), if p.output { Dir::Out } else { Dir::In }, id));
            for (i, b) in p.bits.iter().enumerate() {
                let bit = Expr::Index(Box::new(Expr::Sig(id)), Box::new(Expr::Num(Val::new(32, i as u128))));
                if p.output {
                    let src = self.gw(&mut wires, prefix, *b);
                    self.procs.push(Proc::Comb(vec![Stmt::Assign(LValue { sig: id, sel: Sel::Bit(Box::new(Expr::Num(Val::new(32, i as u128)))) }, src)]));
                } else if let Pin::W(_) = b {
                    let w = self.gw(&mut wires, prefix, *b);
                    self.procs.push(Proc::Comb(vec![Stmt::Assign(lv(sig_of(&w)), bit)]));
                }
            }
        }
        // a mux tree over a truth table (not an indexed read): an x input
        // then only matters where the table really depends on it, as in RTL
        fn tree(init: u128, ins: &[Expr], k: usize, base: usize) -> Expr {
            if k == 0 { return Expr::Num(Val::new(1, (init >> base) & 1)); }
            let half = 1usize << (k - 1);
            let part = |b: usize| (init >> b) & ((1u128 << half) - 1);
            // input k-1 does not matter here: one subtree
            if part(base) == part(base + half) { return tree(init, ins, k - 1, base); }
            let (lo, hi) = (tree(init, ins, k - 1, base), tree(init, ins, k - 1, base + half));
            Expr::Tern(Box::new(ins[k - 1].clone()), Box::new(hi), Box::new(lo))
        }
        for c in &g.cells {
            let pin = |p: &str| c.conns.iter().find(|x| x.0 == p).map(|x| x.1).unwrap_or(Pin::C0);
            macro_rules! i { ($e:expr, $p:expr) => { $e.gw(&mut wires, prefix, pin($p)) } }
            let param = |k: &str| c.params.iter().find(|x| x.0 == k).map(|x| x.1.clone()).unwrap_or_default();
            let t = c.typ.as_str();
            // combinational cells: output pin and its expression
            let comb: Option<(&str, Expr)> = match t {
                "$_NOT_" | "INV" => Some(("Y", not(i!(self, "A")))),
                "BUF" | "CLKBUF" => Some(("Y", i!(self, "A"))),
                "$_AND_" | "AND2" => Some(("Y", bin("&", i!(self, "A"), i!(self, "B")))),
                "$_OR_" | "OR2" => Some(("Y", bin("|", i!(self, "A"), i!(self, "B")))),
                "$_XOR_" | "XOR2" => Some(("Y", bin("^", i!(self, "A"), i!(self, "B")))),
                "NAND2" => Some(("Y", not(bin("&", i!(self, "A"), i!(self, "B"))))),
                "NOR2" => Some(("Y", not(bin("|", i!(self, "A"), i!(self, "B"))))),
                "XNOR2" => Some(("Y", not(bin("^", i!(self, "A"), i!(self, "B"))))),
                "AOI21" => Some(("Y", not(bin("|", bin("&", i!(self, "A"), i!(self, "B")), i!(self, "C"))))),
                "AO21" => Some(("Y", bin("|", bin("&", i!(self, "A"), i!(self, "B")), i!(self, "C")))),
                "OA21" => Some(("Y", bin("&", bin("|", i!(self, "A"), i!(self, "B")), i!(self, "C")))),
                "NAND3" => Some(("Y", not(bin("&", bin("&", i!(self, "A"), i!(self, "B")), i!(self, "C"))))),
                "NOR3" => Some(("Y", not(bin("|", bin("|", i!(self, "A"), i!(self, "B")), i!(self, "C"))))),
                "AND3" => Some(("Y", bin("&", bin("&", i!(self, "A"), i!(self, "B")), i!(self, "C")))),
                "OR3" => Some(("Y", bin("|", bin("|", i!(self, "A"), i!(self, "B")), i!(self, "C")))),
                "AOI22" => Some(("Y", not(bin("|", bin("&", i!(self, "A"), i!(self, "B")), bin("&", i!(self, "C"), i!(self, "D")))))),
                "OAI22" => Some(("Y", not(bin("&", bin("|", i!(self, "A"), i!(self, "B")), bin("|", i!(self, "C"), i!(self, "D")))))),
                "OAI21" => Some(("Y", not(bin("&", bin("|", i!(self, "A"), i!(self, "B")), i!(self, "C"))))),
                "$_MUX_" | "MUX2" => { let (s, a, b) = (i!(self, "S"), i!(self, "A"), i!(self, "B")); Some(("Y", Expr::Tern(Box::new(s), Box::new(b), Box::new(a)))) }
                "TIEL" => Some(("Y", Expr::Num(Val::new(1, 0)))),
                "TIEH" => Some(("Y", Expr::Num(Val::new(1, 1)))),
                "SB_CARRY" => {
                    let (a, b, ci) = (i!(self, "I0"), i!(self, "I1"), i!(self, "CI"));
                    Some(("CO", bin("|", bin("&", a.clone(), b.clone()), bin("&", bin("|", a, b), ci))))
                }
                "SB_LUT4" => {
                    let init = u128::from_str_radix(&param("LUT_INIT"), 2).unwrap_or(0);
                    let ins: Vec<Expr> = ["I0", "I1", "I2", "I3"].iter().map(|p| i!(self, *p)).collect();
                    Some(("O", tree(init, &ins, 4, 0)))
                }
                "LUT4" => {
                    let init = u128::from_str_radix(param("INIT").trim(), 2).unwrap_or(0);
                    let ins: Vec<Expr> = ["A", "B", "C", "D"].iter().map(|p| i!(self, *p)).collect();
                    Some(("Z", tree(init, &ins, 4, 0)))
                }
                _ => None,
            };
            if let Some((out, e)) = comb {
                let o = i!(self, out);
                self.procs.push(Proc::Comb(vec![Stmt::Assign(lv(sig_of(&o)), e)]));
                continue;
            }
            if t == "CCU2C" {
                // two carry-chain halves (yosys techlibs/ecp5/cells_sim.v): S = LUT4 ^ CIN,
                // COUT = LUT4 ? CIN : LUT2 (INJECT1 = "YES" gates CIN and LUT2 off)
                let zero = || Expr::Num(Val::new(1, 0));
                let mut cin = i!(self, "CIN");
                let mut outs = vec![];
                for (h, init_p, inj_p) in [(0, "INIT0", "INJECT1_0"), (1, "INIT1", "INJECT1_1")] {
                    let init = u128::from_str_radix(param(init_p).trim(), 2).unwrap_or(0);
                    let inject = param(inj_p).trim() != "NO";
                    let ins: Vec<Expr> = ["A", "B", "C", "D"].iter().map(|p| i!(self, &format!("{}{}", p, h))).collect();
                    let l4 = tree(init, &ins, 4, 0);
                    let l2 = tree(init & 0xf, &ins[..2], 2, 0);
                    let s = bin("^", l4.clone(), if inject { zero() } else { cin.clone() });
                    let co = bin("|", bin("&", not(l4.clone()), if inject { zero() } else { l2 }), bin("&", l4, cin.clone()));
                    outs.push((if h == 0 { "S0" } else { "S1" }, s));
                    cin = co;
                }
                outs.push(("COUT", cin));
                for (p, e) in outs {
                    if let Pin::W(_) = pin(p) {
                        let o = i!(self, p);
                        self.procs.push(Proc::Comb(vec![Stmt::Assign(lv(sig_of(&o)), e)]));
                    }
                }
                continue;
            }
            // flip-flops: (clock pin, rising, D, Q, reset: (pin, active-high, async, value))
            let mut dpin = "D";
            let ff: Option<(&str, bool, Option<(&str, bool, bool, bool)>)> = if t == "TRELLIS_FF" {
                // ECP5: clock and LSR polarity muxes, REGSET value, SRMODE ASYNC or synchronous
                dpin = "DI";
                let r = c.conns.iter().any(|x| x.0 == "LSR").then(|| ("LSR", param("LSRMUX") != "INV", param("SRMODE") == "ASYNC", param("REGSET") == "SET"));
                Some(("CLK", param("CLKMUX") != "INV", r))
            } else if let Some(k) = t.strip_prefix("SB_DFF") {
                let neg = k.starts_with('N');
                let k = k.trim_start_matches('N');
                let (sync, k) = if k.len() == 2 { (true, &k[1..]) } else { (false, k) };
                let r = match k { "R" => Some(("R", true, !sync, false)), "S" => Some(("S", true, !sync, true)), _ => None };
                Some(("C", !neg, r))
            } else if t.starts_with("$_DFF_") || t.starts_with("$_SDFF_") {
                let f: Vec<char> = t.trim_start_matches("$_").trim_start_matches('S').trim_start_matches("DFF_").chars().collect();
                let r = if f.len() >= 3 { Some(("R", f[1] == 'P', !t.starts_with("$_SDFF"), f[2] == '1')) } else { None };
                Some(("C", f[0] == 'P', r))
            } else {
                match t {
                    "DFF" => Some(("CK", true, None)),
                    "DFFN" => Some(("CK", false, None)),
                    "DFFR" => Some(("CK", true, Some(("RN", false, true, false)))),
                    "DFFS" => Some(("CK", true, Some(("SN", false, true, true)))),
                    "DFFNR" => Some(("CK", false, Some(("RN", false, true, false)))),
                    "DFFNS" => Some(("CK", false, Some(("SN", false, true, true)))),
                    _ => None,
                }
            };
            if let Some((ck, rising, rst)) = ff {
                let (clk, d, q) = (sig_of(&i!(self, ck)), i!(self, dpin), sig_of(&i!(self, "Q")));
                let mut body = vec![Stmt::Assign(lv(q), d)];
                let mut rinfo = None;
                if let Some((rp, high, asynch, val)) = rst {
                    let r = i!(self, rp);
                    let active = if high { r.clone() } else { not(r.clone()) };
                    body = vec![Stmt::If(vec![(active, vec![Stmt::Assign(lv(q), Expr::Num(Val::new(1, val as u128)))])], body)];
                    rinfo = Some((sig_of(&r), !high, asynch));
                    if asynch { self.watched.push(sig_of(&r)); }
                }
                if clk == usize::MAX { continue; } // constant clock: never fires
                self.watched.push(clk);
                self.procs.push(Proc::Ff { clk, pos: rising, rst: rinfo.filter(|x| x.0 != usize::MAX), body });
                continue;
            }
            match t {
                "SB_RAM40_4K" | "SRAM" => self.gate_ram(c, prefix, &mut wires)?,
                _ => return Err(format!("gate-level simulation: unknown cell '{}'", t)),
            }
        }
        Ok(sc)
    }

    /// a RAM in its logical shape: words × width, one synchronous write and one
    /// synchronous read port (SB_RAM40_4K in mode m: 256 << m words of 16 >> m bits)
    fn new_sig(&mut self, name: String, w: u32) -> usize {
        let id = self.sim.sigs.len();
        self.sim.sigs.push(Signal { name, w, signed: false, kind: Kind::Normal, val: Val::allx(w), arr: None, fields: vec![] });
        id
    }

    /// the signal of a netlist wire (created on first use), or a constant
    fn gw(&mut self, wires: &mut HashMap<u32, usize>, prefix: &str, p: Pin) -> Expr {
        match p {
            Pin::C0 => Expr::Num(Val::new(1, 0)),
            Pin::C1 => Expr::Num(Val::new(1, 1)),
            Pin::W(w) => {
                if let Some(&id) = wires.get(&w) { return Expr::Sig(id); }
                let id = self.new_sig(format!("{}.n{}", prefix, w), 1);
                wires.insert(w, id);
                Expr::Sig(id)
            }
        }
    }

    fn gate_ram(&mut self, c: &GCell, prefix: &str, wires: &mut HashMap<u32, usize>) -> R<()> {
        let pin = |p: &str| c.conns.iter().find(|x| x.0 == p).map(|x| x.1).unwrap_or(Pin::C0);
        let param = |k: &str| c.params.iter().find(|x| x.0 == k).map(|x| usize::from_str_radix(&x.1, 2).unwrap_or(0)).unwrap_or(0);
        let ram = c.typ == "SB_RAM40_4K";
        let (depth, width, abits) = if ram { let m = param("READ_MODE"); (256 << m, 16 >> m, 8 + m) } else { (param("DEPTH"), param("WIDTH"), param("ABITS")) };
        let mode = param("READ_MODE");
        let data_pin = |d: usize| -> usize { match mode { 0 => d, 1 => 2 * d, 2 => 4 * d + 1, _ => 8 * d + 3 } };
        let name = |p: &str, k: usize| if ram { format!("{}[{}]", p, k) } else { format!("{}[{}]", p, k) };
        let (wd, rd, wa, ra) = if ram { ("WDATA", "RDATA", "WADDR", "RADDR") } else { ("WD", "RDATA", "WA", "RA") };
        let bus = |e: &mut Elab, wires: &mut HashMap<u32, usize>, p: &str, n: usize, map: &dyn Fn(usize) -> usize| -> Expr {
            Expr::Concat((0..n).rev().map(|k| (Expr::Num(Val::new(32, 1)), e.gw(wires, prefix, pin(&name(p, map(k)))))).collect())
        };
        // the memory: `depth` element signals
        let first = self.sim.sigs.len();
        for k in 0..depth {
            self.sim.sigs.push(Signal { name: format!("{}.mem{}[{}]", prefix, self.sim.sigs.len(), k), w: width as u32, signed: false, kind: Kind::Normal, val: Val::allx(width as u32), arr: None, fields: vec![] });
        }
        self.sim.sigs[first].arr = Some(depth as u32);
        let id = |k: usize| k;
        let waddr = bus(self, wires, wa, abits, &id);
        let raddr = bus(self, wires, ra, abits, &id);
        let wdata = if ram { bus(self, wires, wd, width, &data_pin) } else { bus(self, wires, wd, width, &id) };
        let g = |e: &mut Elab, wires: &mut HashMap<u32, usize>, p: &str| e.gw(wires, prefix, pin(p));
        let (we, re) = if ram {
            let (we, wce) = (g(self, wires, "WE"), g(self, wires, "WCLKE"));
            let (re, rce) = (g(self, wires, "RE"), g(self, wires, "RCLKE"));
            (bin("&", we, wce), bin("&", re, rce))
        } else { (g(self, wires, "WE"), g(self, wires, "RE")) };
        let clk_pin = if ram { "RCLK" } else { "CK" };
        let clk = match g(self, wires, clk_pin) { Expr::Sig(s) => s, _ => return Ok(()) };
        // read register: one signal per data bit, then copied to the RDATA wires
        let rreg = self.sim.sigs.len();
        self.sim.sigs.push(Signal { name: format!("{}.rdata{}", prefix, rreg), w: width as u32, signed: false, kind: Kind::Normal, val: Val::allx(width as u32), arr: None, fields: vec![] });
        let read = Stmt::If(vec![(re, vec![Stmt::Assign(lv(rreg), Expr::Elem(first, Box::new(raddr)))])], vec![]);
        let write = Stmt::If(vec![(we, vec![Stmt::Assign(LValue { sig: first, sel: Sel::Elem(Box::new(waddr)) }, wdata)])], vec![]);
        self.watched.push(clk);
        self.procs.push(Proc::Ff { clk, pos: true, rst: None, body: vec![read, write] });
        for d in 0..width {
            let p = if ram { data_pin(d) } else { d };
            if let Expr::Sig(o) = self.gw(wires, prefix, pin(&name(rd, p))) {
                let bit = Expr::Index(Box::new(Expr::Sig(rreg)), Box::new(Expr::Num(Val::new(32, d as u128))));
                self.procs.push(Proc::Comb(vec![Stmt::Assign(lv(o), bit)]));
            }
        }
        Ok(())
    }
}
