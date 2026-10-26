//! GDSII stream output of a library layout (SKY130): the cells' own
//! structures copied from the PDK's GDS, a top structure that places them
//! (SREF, mirrored for flipped rows) and draws the routing, vias, power grid
//! and IO pins as boxes on the PDK's layer / datatype numbers, with labels.
//! Units: 1 nm database unit, 1 µm user unit (as the PDK's file).

use super::layout::Layout;
use std::collections::{HashMap, HashSet};

/// SKY130 layer numbers: (drawing, pin) datatypes; labels use datatype 5
pub fn sky130_layer(name: &str) -> Option<(i16, i16, i16)> {
    Some(match name {
        "li1" => (67, 20, 16),
        "mcon" => (67, 44, 44),
        "met1" => (68, 20, 16),
        "via" => (68, 44, 44),
        "met2" => (69, 20, 16),
        "via2" => (69, 44, 44),
        "met3" => (70, 20, 16),
        "via3" => (70, 44, 44),
        "met4" => (71, 20, 16),
        "via4" => (71, 44, 44),
        "met5" => (72, 20, 16),
        _ => return None,
    })
}

struct W(Vec<u8>);
impl W {
    fn rec(&mut self, rt: u16, data: &[u8]) {
        let len = (4 + data.len() + data.len() % 2) as u16;
        self.0.extend(len.to_be_bytes());
        self.0.extend(rt.to_be_bytes());
        self.0.extend(data);
        if data.len() % 2 == 1 { self.0.push(0); }
    }
    fn i16s(&mut self, rt: u16, v: &[i16]) { let d: Vec<u8> = v.iter().flat_map(|x| x.to_be_bytes()).collect(); self.rec(rt, &d); }
    fn i32s(&mut self, rt: u16, v: &[i32]) { let d: Vec<u8> = v.iter().flat_map(|x| x.to_be_bytes()).collect(); self.rec(rt, &d); }
    fn s(&mut self, rt: u16, s: &str) { self.rec(rt, s.as_bytes()); }
    fn real8(&mut self, rt: u16, v: &[f64]) { let d: Vec<u8> = v.iter().flat_map(|x| real8(*x)).collect(); self.rec(rt, &d); }
}

/// GDSII 8-byte real: sign, 7-bit excess-64 base-16 exponent, 56-bit mantissa
pub fn real8(v: f64) -> [u8; 8] {
    if v == 0.0 { return [0; 8]; }
    let (sign, mut m) = (v < 0.0, v.abs());
    let mut e: i32 = 64;
    while m >= 1.0 { m /= 16.0; e += 1; }
    while m < 1.0 / 16.0 { m *= 16.0; e -= 1; }
    let mant = (m * (1u64 << 56) as f64).round() as u64;
    let mut out = [0u8; 8];
    out[0] = (if sign { 0x80 } else { 0 }) | (e as u8 & 0x7f);
    for k in 0..7 { out[1 + k] = (mant >> (8 * (6 - k))) as u8; }
    out
}

/// the structures of a GDS file by name (their raw records, BGNSTR .. ENDSTR)
pub fn structures(gds: &[u8]) -> HashMap<String, Vec<u8>> {
    let mut out = HashMap::new();
    let mut i = 0;
    let mut start = None;
    let mut name = String::new();
    while i + 4 <= gds.len() {
        let len = u16::from_be_bytes([gds[i], gds[i + 1]]) as usize;
        if len < 4 { break; }
        let rt = gds[i + 2];
        match rt {
            0x05 => start = Some(i),
            0x06 => name = String::from_utf8_lossy(&gds[i + 4..i + len]).trim_end_matches('\0').to_string(),
            0x07 => { if let Some(s) = start.take() { out.insert(name.clone(), gds[s..i + len].to_vec()); } }
            _ => {}
        }
        i += len;
    }
    out
}

/// the layout as GDSII, with the cells taken from `cell_gds`
pub fn write(l: &Layout, design: &str, cell_gds: &[u8]) -> Result<Vec<u8>, String> {
    let lib = structures(cell_gds);
    let mut w = W(vec![]);
    let date: [i16; 12] = [2026, 1, 1, 0, 0, 0, 2026, 1, 1, 0, 0, 0];
    w.i16s(0x0002, &[600]);
    w.i16s(0x0102, &date);
    w.s(0x0206, design);
    w.real8(0x0305, &[0.001, 1e-9]);
    // the cells used, then the cells they reference
    let mut need: Vec<String> = l.insts.iter().map(|i| i.cell.clone()).collect::<HashSet<_>>().into_iter().collect();
    need.sort();
    let mut done: HashSet<String> = HashSet::new();
    while let Some(n) = need.pop() {
        if !done.insert(n.clone()) { continue; }
        let s = lib.get(&n).ok_or_else(|| format!("cell {} is not in the GDS library", n))?;
        // SNAME records inside: referenced structures
        let mut i = 0;
        while i + 4 <= s.len() {
            let len = u16::from_be_bytes([s[i], s[i + 1]]) as usize;
            if len < 4 { break; }
            if s[i + 2] == 0x12 { need.push(String::from_utf8_lossy(&s[i + 4..i + len]).trim_end_matches('\0').to_string()); }
            i += len;
        }
        w.0.extend(s);
    }
    // the top structure
    w.i16s(0x0502, &date);
    w.s(0x0606, design);
    for inst in &l.insts {
        w.rec(0x0A00, &[]);
        w.s(0x1206, &inst.cell);
        if inst.flip {
            // mirrored about the x axis, then moved up by the cell height
            w.rec(0x1A01, &0x8000u16.to_be_bytes());
            w.i32s(0x1003, &[inst.x as i32, (inst.y + inst.h) as i32]);
        } else {
            w.i32s(0x1003, &[inst.x as i32, inst.y as i32]);
        }
        w.rec(0x1100, &[]);
    }
    for s in &l.shapes {
        let Some((layer, dt, _)) = sky130_layer(&l.layers[s.layer as usize]) else { continue };
        w.rec(0x0800, &[]);
        w.i16s(0x0D02, &[layer]);
        w.i16s(0x0E02, &[dt]);
        let (x0, y0, x1, y1) = (s.x0 as i32, s.y0 as i32, s.x1 as i32, s.y1 as i32);
        w.i32s(0x1003, &[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]);
        w.rec(0x1100, &[]);
    }
    // IO pins: pin shapes and labels
    for (li, x, y, name) in &l.labels {
        let Some((layer, _, pin)) = sky130_layer(&l.layers[*li as usize]) else { continue };
        let h = 150;
        w.rec(0x0800, &[]);
        w.i16s(0x0D02, &[layer]);
        w.i16s(0x0E02, &[pin]);
        let (x, y) = (*x as i32, *y as i32);
        w.i32s(0x1003, &[x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h, x - h, y - h]);
        w.rec(0x1100, &[]);
        w.rec(0x0C00, &[]);
        w.i16s(0x0D02, &[layer]);
        w.i16s(0x1602, &[5]);
        w.i32s(0x1003, &[x, y]);
        w.s(0x1906, name);
        w.rec(0x1100, &[]);
    }
    w.rec(0x0700, &[]);
    w.rec(0x0400, &[]);
    Ok(w.0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn real8_units() {
        // 1e-3 and 1e-9 as every GDS file writes them
        assert_eq!(super::real8(0.001), [0x3e, 0x41, 0x89, 0x37, 0x4b, 0xc6, 0xa7, 0xf0]);
        assert_eq!(super::real8(1e-9), [0x39, 0x44, 0xb8, 0x2f, 0xa0, 0x9b, 0x5a, 0x54]);
    }
}
