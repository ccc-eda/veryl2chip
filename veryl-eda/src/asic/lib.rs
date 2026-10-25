//! A small educational standard-cell library ("vlib"): rows 4.0 µm high,
//! placement sites 0.5 µm wide, delays roughly in the range of a 130 nm
//! process (slow corner). Delay = intrinsic + load factor × fanout.

/// row height and site width in µm
pub const ROW_H: f64 = 4.0;
pub const SITE_W: f64 = 0.5;

pub struct StdCell {
    pub name: &'static str,
    /// input pins (outputs are `Y`, or `Q` for flip-flops)
    pub ins: &'static [&'static str],
    /// width in sites
    pub width: u32,
    /// intrinsic delay (ns); for flip-flops: clock -> Q
    pub delay: f64,
    /// extra delay per fanout (ns)
    pub load: f64,
    /// setup time (flip-flops)
    pub setup: f64,
    /// Verilog behaviour (the output assignment / always block)
    pub verilog: &'static str,
}

pub const LIB: &[StdCell] = &[
    StdCell { name: "INV", ins: &["A"], width: 2, delay: 0.025, load: 0.010, setup: 0.0, verilog: "assign Y = ~A;" },
    StdCell { name: "BUF", ins: &["A"], width: 3, delay: 0.045, load: 0.007, setup: 0.0, verilog: "assign Y = A;" },
    StdCell { name: "NAND2", ins: &["A", "B"], width: 3, delay: 0.035, load: 0.014, setup: 0.0, verilog: "assign Y = ~(A & B);" },
    StdCell { name: "NOR2", ins: &["A", "B"], width: 3, delay: 0.045, load: 0.018, setup: 0.0, verilog: "assign Y = ~(A | B);" },
    StdCell { name: "AND2", ins: &["A", "B"], width: 4, delay: 0.065, load: 0.009, setup: 0.0, verilog: "assign Y = A & B;" },
    StdCell { name: "OR2", ins: &["A", "B"], width: 4, delay: 0.075, load: 0.010, setup: 0.0, verilog: "assign Y = A | B;" },
    StdCell { name: "XOR2", ins: &["A", "B"], width: 6, delay: 0.085, load: 0.014, setup: 0.0, verilog: "assign Y = A ^ B;" },
    StdCell { name: "XNOR2", ins: &["A", "B"], width: 6, delay: 0.085, load: 0.014, setup: 0.0, verilog: "assign Y = ~(A ^ B);" },
    StdCell { name: "AOI21", ins: &["A", "B", "C"], width: 4, delay: 0.050, load: 0.018, setup: 0.0, verilog: "assign Y = ~((A & B) | C);" },
    StdCell { name: "OAI21", ins: &["A", "B", "C"], width: 4, delay: 0.050, load: 0.018, setup: 0.0, verilog: "assign Y = ~((A | B) & C);" },
    StdCell { name: "MUX2", ins: &["A", "B", "S"], width: 7, delay: 0.090, load: 0.012, setup: 0.0, verilog: "assign Y = S ? B : A;" },
    StdCell { name: "TIEL", ins: &[], width: 2, delay: 0.0, load: 0.0, setup: 0.0, verilog: "assign Y = 1'b0;" },
    StdCell { name: "TIEH", ins: &[], width: 2, delay: 0.0, load: 0.0, setup: 0.0, verilog: "assign Y = 1'b1;" },
    StdCell { name: "DFF", ins: &["CK", "D"], width: 14, delay: 0.180, load: 0.010, setup: 0.080, verilog: "always @(posedge CK) Q <= D;" },
    StdCell { name: "DFFN", ins: &["CK", "D"], width: 14, delay: 0.180, load: 0.010, setup: 0.080, verilog: "always @(negedge CK) Q <= D;" },
    StdCell { name: "DFFR", ins: &["CK", "D", "RN"], width: 16, delay: 0.200, load: 0.010, setup: 0.090, verilog: "always @(posedge CK or negedge RN) if (!RN) Q <= 1'b0; else Q <= D;" },
    StdCell { name: "DFFS", ins: &["CK", "D", "SN"], width: 16, delay: 0.200, load: 0.010, setup: 0.090, verilog: "always @(posedge CK or negedge SN) if (!SN) Q <= 1'b1; else Q <= D;" },
    StdCell { name: "DFFNR", ins: &["CK", "D", "RN"], width: 16, delay: 0.200, load: 0.010, setup: 0.090, verilog: "always @(negedge CK or negedge RN) if (!RN) Q <= 1'b0; else Q <= D;" },
    StdCell { name: "DFFNS", ins: &["CK", "D", "SN"], width: 16, delay: 0.200, load: 0.010, setup: 0.090, verilog: "always @(negedge CK or negedge SN) if (!SN) Q <= 1'b1; else Q <= D;" },
];

pub fn cell(name: &str) -> &'static StdCell {
    LIB.iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no standard cell {}", name))
}

pub fn is_ff(name: &str) -> bool { name.starts_with("DFF") }

/// area in µm²
pub fn area(name: &str) -> f64 { cell(name).width as f64 * SITE_W * ROW_H }

// ---- SRAM macros (what a memory compiler would deliver) ----
// one write port, one synchronous read port: pins CK, WE, WA[i], WD[i], RE,
// RA[i], RDATA[i]; parameters DEPTH, WIDTH (binary). A memory with several
// read ports gets one macro per port.

/// bit cell area (µm², 6T at ~130 nm) and periphery overhead
const SRAM_BIT: f64 = 2.0;
pub const SRAM_CLK_Q: f64 = 0.65;
pub const SRAM_SETUP: f64 = 0.15;

pub fn param(c: &crate::netlist::Cell, k: &str) -> usize {
    c.params.iter().find(|p| p.0 == k).map(|p| usize::from_str_radix(&p.1, 2).unwrap_or(0)).unwrap_or(0)
}

/// SRAM macro size in (sites, rows): bit array plus decoder / sense-amp periphery, roughly square
pub fn sram_dims(depth: usize, width: usize) -> (u32, u32) {
    let area = (depth * width) as f64 * SRAM_BIT * 1.3 + 300.0;
    let rows = ((area.sqrt() / ROW_H).round() as u32).max(2);
    let sites = (area / (rows as f64 * ROW_H) / SITE_W).ceil() as u32;
    (sites, rows)
}

/// (width in sites, height in rows) of any cell of a mapped netlist
pub fn dims(c: &crate::netlist::Cell) -> (u32, u32) {
    if c.typ == "SRAM" { sram_dims(param(c, "DEPTH"), param(c, "WIDTH")) } else { (cell(&c.typ).width, 1) }
}

pub fn cell_area(c: &crate::netlist::Cell) -> f64 { let (w, h) = dims(c); w as f64 * SITE_W * h as f64 * ROW_H }

/// static pin names "BASE[i]"
pub fn pin(base: &str, i: usize) -> &'static str {
    use std::sync::{Mutex, OnceLock};
    static NAMES: OnceLock<Mutex<std::collections::HashMap<String, &'static str>>> = OnceLock::new();
    let key = format!("{}[{}]", base, i);
    let mut m = NAMES.get_or_init(|| Mutex::new(std::collections::HashMap::new())).lock().unwrap();
    if let Some(s) = m.get(&key) { return s; }
    let s: &'static str = Box::leak(key.clone().into_boxed_str());
    m.insert(key, s);
    s
}

/// Verilog models of the library (for simulation and formal checks)
pub fn verilog_models() -> String {
    let mut s = String::from("// vlib standard cells (veryl-eda), behavioural models\n");
    for c in LIB {
        let out = if is_ff(c.name) { "output reg Q" } else { "output Y" };
        let ins: Vec<String> = c.ins.iter().map(|p| format!("input {}", p)).collect();
        let ports = if ins.is_empty() { out.to_string() } else { format!("{}, {}", ins.join(", "), out) };
        let init = if is_ff(c.name) { "\n  initial Q = 1'b0;" } else { "" };
        s += &format!("module {} ({});{}\n  {}\nendmodule\n", c.name, ports, init, c.verilog);
    }
    s += "module SRAM #(parameter DEPTH = 256, parameter WIDTH = 8, parameter ABITS = 8) (\n  input CK, input WE, input [ABITS-1:0] WA, input [WIDTH-1:0] WD,\n  input RE, input [ABITS-1:0] RA, output reg [WIDTH-1:0] RDATA);\n  reg [WIDTH-1:0] mem [0:DEPTH-1];\n  always @(posedge CK) begin\n    if (RE) RDATA <= mem[RA];\n    if (WE) mem[WA] <= WD;\n  end\nendmodule\n";
    s
}
