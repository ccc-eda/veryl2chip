//! Block RAM inference for iCE40: an array the elaborator recorded as a
//! memory (named nets `$mem:NAME:...`, see `elab::MemInfo`) whose read ports
//! are *synchronous* (each read data bit goes straight into a flip-flop on
//! the write clock, optionally with an enable) becomes `SB_RAM40_4K` blocks:
//! the element flip-flops, the read registers and the address decoding /
//! read multiplexers they needed disappear. Asynchronous reads stay logic,
//! because the block RAM only has a registered read port.
//!
//! Modes: 256×16, 512×8, 1024×4, 2048×2 (READ_MODE = WRITE_MODE = 0..3);
//! wider words use several blocks side by side, and every read port gets its
//! own copy of the memory (same write port).

use crate::netlist::*;
use std::collections::HashMap;

pub const RADDR: [&str; 11] = ["RADDR[0]", "RADDR[1]", "RADDR[2]", "RADDR[3]", "RADDR[4]", "RADDR[5]", "RADDR[6]", "RADDR[7]", "RADDR[8]", "RADDR[9]", "RADDR[10]"];
pub const WADDR: [&str; 11] = ["WADDR[0]", "WADDR[1]", "WADDR[2]", "WADDR[3]", "WADDR[4]", "WADDR[5]", "WADDR[6]", "WADDR[7]", "WADDR[8]", "WADDR[9]", "WADDR[10]"];
pub const WDATA: [&str; 16] = ["WDATA[0]", "WDATA[1]", "WDATA[2]", "WDATA[3]", "WDATA[4]", "WDATA[5]", "WDATA[6]", "WDATA[7]", "WDATA[8]", "WDATA[9]", "WDATA[10]", "WDATA[11]", "WDATA[12]", "WDATA[13]", "WDATA[14]", "WDATA[15]"];
pub const MASK: [&str; 16] = ["MASK[0]", "MASK[1]", "MASK[2]", "MASK[3]", "MASK[4]", "MASK[5]", "MASK[6]", "MASK[7]", "MASK[8]", "MASK[9]", "MASK[10]", "MASK[11]", "MASK[12]", "MASK[13]", "MASK[14]", "MASK[15]"];
pub const RDATA: [&str; 16] = ["RDATA[0]", "RDATA[1]", "RDATA[2]", "RDATA[3]", "RDATA[4]", "RDATA[5]", "RDATA[6]", "RDATA[7]", "RDATA[8]", "RDATA[9]", "RDATA[10]", "RDATA[11]", "RDATA[12]", "RDATA[13]", "RDATA[14]", "RDATA[15]"];

/// RAM data pins used by data bit `d` in a mode (yosys cells_sim.v)
pub fn data_pin(mode: usize, d: usize) -> usize {
    match mode { 0 => d, 1 => 2 * d, 2 => 4 * d + 1, _ => 8 * d + 3 }
}

/// a memory with synchronous reads, found in a generic netlist
pub struct Mem {
    pub name: String,
    pub depth: usize,
    pub width: usize,
    pub clk: Bit,
    pub we: Bit,
    pub waddr: Vec<Bit>,
    pub wdata: Vec<Bit>,
    pub reads: Vec<ReadPort>,
}

pub struct ReadPort {
    pub addr: Vec<Bit>,
    /// read enable (C1 = always)
    pub en: Bit,
    /// the read register output of each data bit (None = bit unused)
    pub data: Vec<Option<Bit>>,
}

/// Memories (see the module comment) and the netlist without their element
/// flip-flops, read registers and the logic only they used.
pub fn find_mems(nl: &Netlist) -> (Netlist, Vec<Mem>) {
    let net = |n: &str| nl.nets.iter().find(|(k, _)| k == n).map(|(_, b)| b.clone());
    let names: Vec<String> = nl.nets.iter().filter_map(|(n, _)| n.strip_prefix("$mem:").and_then(|r| r.strip_suffix(":clk")).map(|s| s.to_string())).collect();
    // consumers of every wire: (cell index, pin)
    let mut users: HashMap<Bit, Vec<(usize, &'static str)>> = HashMap::new();
    for (i, c) in nl.cells.iter().enumerate() {
        for (p, b) in &c.conns { if !is_out(p) { users.entry(*b).or_default().push((i, p)); } }
    }
    let port_bits: std::collections::HashSet<Bit> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.iter().copied()).collect();
    let q_cell: HashMap<Bit, usize> = nl.cells.iter().enumerate().filter(|(_, c)| c.is_ff()).map(|(i, c)| (c.out(), i)).collect();
    let mut dead = vec![false; nl.cells.len()];
    let mut mems = vec![];
    'mem: for q in names {
        let g = |s: &str| net(&format!("$mem:{}:{}", q, s));
        let (Some(clk), Some(we), Some(wa), Some(wd), Some(store)) = (g("clk"), g("we"), g("wa"), g("wd"), net(&q)) else { continue };
        let (clk, we, width) = (clk[0], we[0], wd.len());
        if width == 0 || store.len() % width != 0 { continue; }
        let depth = store.len() / width;
        let abits = bits_for(depth);
        if depth != 1 << abits || wa.len() != abits { continue; }
        let plain_ff = |i: usize| nl.cells[i].typ == "$_DFF_P_" && nl.cells[i].port("C") == Some(clk);
        // the storage: rising-edge flip-flops on the write clock; a data bit no read
        // uses has lost its flip-flops already (dead logic): only those may be missing
        let mut elems = vec![];
        let mut missing = vec![false; width];
        for (k, b) in store.iter().enumerate() {
            match q_cell.get(b) { Some(&i) if plain_ff(i) => elems.push(i), Some(_) => continue 'mem, None => missing[k % width] = true }
        }
        let mut reads = vec![];
        let mut gone_all = vec![];
        for k in 0.. {
            let (Some(ra), Some(rd)) = (g(&format!("ra{}", k)), g(&format!("rd{}", k))) else { break };
            if rd.len() != width { continue 'mem; }
            // address bits above the memory size must be 0 (no wrap-around)
            if ra.iter().skip(abits).any(|b| *b != Bit::C0) { continue 'mem; }
            let mut en: Option<Bit> = None;
            let mut data = vec![];
            let mut gone = vec![];
            for b in &rd {
                if !matches!(b, Bit::W(_)) || port_bits.contains(b) { continue 'mem; }
                let u = users.get(b).cloned().unwrap_or_default();
                // an unused read bit needs no register
                if u.is_empty() { data.push(None); continue; }
                if u.len() != 1 { continue 'mem; }
                let (i, p) = u[0];
                let c = &nl.cells[i];
                let (ff, e) = if p == "D" && plain_ff(i) {
                    (i, Bit::C1)
                } else if p == "B" && c.typ == "$_MUX_" && !port_bits.contains(&c.out()) {
                    // enable: D = en ? rd : Q
                    let uu = users.get(&c.out()).cloned().unwrap_or_default();
                    if uu.len() != 1 || uu[0].1 != "D" || !plain_ff(uu[0].0) || c.port("A") != Some(nl.cells[uu[0].0].out()) { continue 'mem; }
                    gone.push(i);
                    (uu[0].0, c.port("S").unwrap())
                } else { continue 'mem };
                if *en.get_or_insert(e) != e { continue 'mem; }
                gone.push(ff);
                data.push(Some(nl.cells[ff].out()));
            }
            if data.iter().all(|r| r.is_none()) { continue; }
            gone_all.extend(gone);
            reads.push(ReadPort { addr: ra[..abits.min(ra.len())].to_vec(), en: en.unwrap_or(Bit::C1), data });
        }
        if reads.is_empty() { continue; }
        if (0..width).any(|j| missing[j] && reads.iter().any(|r| r.data[j].is_some())) { continue; }
        for i in elems.into_iter().chain(gone_all) { dead[i] = true; }
        mems.push(Mem { name: q.clone(), depth, width, clk, we, waddr: wa, wdata: wd, reads });
    }
    let mut cells: Vec<Cell> = nl.cells.iter().enumerate().filter(|(i, _)| !dead[*i]).map(|x| x.1.clone()).collect();
    let mut roots: Vec<Bit> = nl.ports.iter().filter(|p| p.dir == Dir::Out).flat_map(|p| p.bits.clone()).collect();
    for m in &mems {
        roots.extend([m.clk, m.we]);
        roots.extend(m.waddr.iter().chain(&m.wdata).copied());
        for r in &m.reads { roots.push(r.en); roots.extend(r.addr.iter().copied()); }
    }
    sweep(&mut cells, &roots);
    let ports = nl.ports.iter().map(|p| Port { name: p.name.clone(), dir: p.dir, bits: p.bits.clone() }).collect();
    (Netlist { name: nl.name.clone(), ports, nets: nl.nets.clone(), cells }, mems)
}

pub struct Inferred {
    /// the netlist without the memories' flip-flops and read logic
    pub nl: Netlist,
    pub rams: Vec<Cell>,
}

/// iCE40: memories up to 2048 words become SB_RAM40_4K blocks
pub fn infer(nl: &Netlist) -> Inferred {
    let (stripped, all) = find_mems(nl);
    // deeper memories stay logic: put them back by not stripping them
    if all.iter().any(|m| m.depth > 2048) {
        let keep: Vec<String> = all.iter().filter(|m| m.depth > 2048).map(|m| format!("$mem:{}:clk", m.name)).collect();
        let nets = nl.nets.iter().filter(|(n, _)| !keep.contains(n)).cloned().collect();
        let nl2 = Netlist { name: nl.name.clone(), ports: nl.ports.iter().map(|p| Port { name: p.name.clone(), dir: p.dir, bits: p.bits.clone() }).collect(), nets, cells: nl.cells.clone() };
        return infer(&nl2);
    }
    let mut next_wire = nl.cells.iter().flat_map(|c| c.conns.iter().map(|x| x.1)).chain(nl.ports.iter().flat_map(|p| p.bits.iter().copied()))
        .chain(nl.nets.iter().flat_map(|n| n.1.iter().copied()))
        .filter_map(|b| if let Bit::W(w) = b { Some(w) } else { None }).max().unwrap_or(1) + 1;
    let mut rams = vec![];
    for m in &all {
        let mode = match m.depth { 0..=256 => 0, 257..=512 => 1, 513..=1024 => 2, _ => 3 };
        let bw = 16 >> mode;
        let blocks = m.width.div_ceil(bw);
        let a = |v: &[Bit], i: usize| v.get(i).copied().unwrap_or(Bit::C0);
        for r in &m.reads {
            for k in 0..blocks {
                let mut conns: Vec<(&'static str, Bit)> = vec![("RCLK", m.clk), ("RCLKE", r.en), ("RE", Bit::C1), ("WCLK", m.clk), ("WCLKE", Bit::C1), ("WE", m.we)];
                for i in 0..11 { conns.push((RADDR[i], a(&r.addr, i))); conns.push((WADDR[i], a(&m.waddr, i))); }
                let mut wdata = [Bit::C0; 16];
                let mut rdata: [Option<Bit>; 16] = [None; 16];
                for d in 0..bw {
                    let j = k * bw + d;
                    if j >= m.width { break; }
                    wdata[data_pin(mode, d)] = m.wdata[j];
                    rdata[data_pin(mode, d)] = r.data[j];
                }
                for i in 0..16 { conns.push((WDATA[i], wdata[i])); conns.push((MASK[i], Bit::C0)); }
                for i in 0..16 {
                    let b = rdata[i].unwrap_or_else(|| { next_wire += 1; Bit::W(next_wire - 1) });
                    conns.push((RDATA[i], b));
                }
                let mut params: Vec<(&'static str, String)> = vec![("READ_MODE", format!("{:032b}", mode)), ("WRITE_MODE", format!("{:032b}", mode))];
                for name in INIT { params.push((name, "0".repeat(256))); }
                params.push((SLOT, format!("{}:{}", m.name, k)));
                rams.push(Cell { typ: "SB_RAM40_4K".into(), conns, params });
            }
        }
    }
    Inferred { nl: stripped, rams }
}

/// Which memory a block RAM holds: `NAME:BLOCK` (block k has data bits k·bw.. of
/// every word); kept so a program can be put into the memory after mapping, or
/// into a placed-and-routed bitstream (`pnr::patch_ram`). Not an iCE40 parameter:
/// the yosys JSON writes it as an attribute.
pub const SLOT: &str = "MEM_SLOT";

/// INIT_0..INIT_F (msb first) of block `k` of a memory in `mode`, from its words
/// (word a, data bit d is RAM bit (d << mode) | lane of RAM word a & 0xff, lane = a >> 8)
pub fn init_strings(mode: usize, k: usize, words: &[u64]) -> Vec<String> {
    let bw = 16 >> mode;
    let mut ram = [0u16; 256];
    for (a, w) in words.iter().enumerate().take(256 << mode) {
        let lane = (a >> 8) & ((1 << mode) - 1);
        for d in 0..bw {
            let j = k * bw + d;
            if j < 64 && (w >> j) & 1 == 1 { ram[a & 0xff] |= 1 << ((d << mode) | lane); }
        }
    }
    (0..16).map(|i| (0..256).map(|p| { let bit = 255 - p; if (ram[i * 16 + bit / 16] >> (bit % 16)) & 1 == 1 { '1' } else { '0' } }).collect()).collect()
}

/// the memory and block of a block RAM cell (see `SLOT`) and its mode
pub fn slot_of(c: &Cell) -> Option<(String, usize, usize)> {
    let s = &c.params.iter().find(|x| x.0 == SLOT)?.1;
    let (name, k) = s.rsplit_once(':')?;
    let mode = c.params.iter().find(|x| x.0 == "READ_MODE").and_then(|x| usize::from_str_radix(&x.1, 2).ok()).unwrap_or(0);
    Some((name.to_string(), k.parse().ok()?, mode))
}

/// Give memory `name` initial contents in a mapped iCE40 netlist; the number of blocks changed
pub fn set_mem_init(nl: &mut Netlist, name: &str, words: &[u64]) -> usize {
    let mut n = 0;
    for c in nl.cells.iter_mut().filter(|c| c.typ == "SB_RAM40_4K") {
        let Some((m, k, mode)) = slot_of(c) else { continue };
        if m != name { continue; }
        let init = init_strings(mode, k, words);
        for (p, v) in c.params.iter_mut() {
            if let Some(i) = INIT.iter().position(|x| x == p) { *v = init[i].clone(); }
        }
        n += 1;
    }
    n
}

/// A program (bytes from address 0) as the contents of a 32-bit memory made of four
/// byte lanes `PREFIX.b0.mem` .. `PREFIX.b3.mem` (RvMem in examples/src/rvsoc.veryl)
pub fn program_lanes(mems: &[String], bytes: &[u8]) -> Result<Vec<(String, Vec<u64>)>, String> {
    let lane0: Vec<&String> = mems.iter().filter(|m| m.ends_with("b0.mem")).collect();
    let [p] = lane0.as_slice() else { return Err(format!("no single program memory (byte lanes *.b0.mem .. *.b3.mem) among {:?}", mems)) };
    let prefix = &p[..p.len() - "b0.mem".len()];
    (0..4).map(|k| {
        let name = format!("{}b{}.mem", prefix, k);
        if !mems.contains(&name) { return Err(format!("no memory {}", name)); }
        Ok((name, bytes.iter().skip(k).step_by(4).map(|b| *b as u64).collect()))
    }).collect()
}

/// names of the memories in block RAMs of a mapped netlist
pub fn mem_names(nl: &Netlist) -> Vec<String> {
    let mut v: Vec<String> = nl.cells.iter().filter_map(slot_of).map(|s| s.0).collect();
    v.dedup();
    v
}

pub const INIT: [&str; 16] = ["INIT_0", "INIT_1", "INIT_2", "INIT_3", "INIT_4", "INIT_5", "INIT_6", "INIT_7",
    "INIT_8", "INIT_9", "INIT_A", "INIT_B", "INIT_C", "INIT_D", "INIT_E", "INIT_F"];
