//! `.asc` -> `.bin` for the iCE40UP5K: the write path of IceStorm's icepack
//! (ISC license, Claire Xenia Wolf; https://github.com/YosysHQ/icestorm),
//! ported for this one device so the web environment can produce a real
//! bitstream. Defaults as icepack's: frequency range low, warm boot
//! enabled, no `nosleep`.

type R<T> = Result<T, String>;

const CHIP_W: i32 = 24;
const CHIP_H: i32 = 30;
const CRAM_W: usize = 692;
const CRAM_H: usize = 336;
const BRAM_W: usize = 160;
const BRAM_H: usize = 2 * 128;
const COLS: [usize; 13] = [54, 54, 54, 54, 54, 54, 42, 54, 54, 54, 54, 54, 54];

fn tile_type(x: i32, y: i32) -> &'static str {
    if (x == 0 || x == CHIP_W + 1) && (y == 0 || y == CHIP_H + 1) { return "corner"; }
    if x == 0 || x == CHIP_W + 1 {
        return match y { 5 | 10 | 15 | 23 => "dsp0", 6 | 11 | 16 | 24 => "dsp1", 7 | 12 | 17 | 25 => "dsp2", 8 | 13 | 18 | 26 => "dsp3", _ => "ipcon" };
    }
    if y == 0 || y == CHIP_H + 1 { return "io"; }
    if x == 6 || x == 19 { return if y % 2 == 1 { "ramb" } else { "ramt" }; }
    "logic"
}

fn tile_width(t: &str) -> usize {
    match t { "corner" => 0, "ramb" | "ramt" => 42, "io" => 18, _ => 54 }
}

/// (bank, x, y) of a tile's config bit
fn cram_index(tx: i32, ty: i32, bx: usize, by: usize) -> (usize, usize, usize) {
    const PERMX: [usize; 18] = [23, 25, 26, 27, 16, 17, 18, 19, 20, 14, 32, 33, 34, 35, 36, 37, 4, 5];
    const PERMY: [usize; 16] = [0, 1, 3, 2, 4, 5, 7, 6, 8, 9, 11, 10, 12, 13, 15, 14];
    let lr_io = tx == 0 || tx == CHIP_W + 1;
    let right = tx > CHIP_W / 2;
    let top = ty > CHIP_H * 2 / 3;
    let bank = (top as usize) | ((right as usize) << 1);
    let btx = (if right { CHIP_W + 1 - tx } else { tx }) as usize;
    let bty = (if top { CHIP_H + 1 - ty } else { ty }) as usize;
    let xoff: usize = COLS[..btx].iter().sum();
    let yoff = 16 * bty;
    let cw = COLS[btx];
    let (x, y);
    if tile_type(tx, ty) == "io" {
        if lr_io {
            x = xoff + cw - 1 - bx;
            y = if top { yoff + 15 - by } else { yoff + by };
        } else {
            y = yoff + 15 - PERMY[by];
            x = if right { xoff + cw - 1 - PERMX[bx] } else { xoff + PERMX[bx] };
        }
    } else {
        x = if right { xoff + cw - 1 - bx } else { xoff + bx };
        y = if top { yoff + 15 - by } else { yoff + by };
    }
    (bank, x, y)
}

fn bram_index(tx: i32, ty: i32, bx: usize, by: usize) -> (usize, usize, usize) {
    let right = tx > CHIP_W / 2;
    let top = ty > 2 * CHIP_H / 3;
    let mut bank = 0;
    let mut yo = ty - 1;
    if top { bank |= 1; yo = ty - 2 * CHIP_H / 3; }
    if right { bank |= 2; }
    let off = 16 * (yo / 2) as usize;
    let index = 256 * by + (16 * (bx / 16) + 15 - bx % 16);
    (bank, off + index % 16, index / 16)
}

fn crc16(crc: &mut u16, byte: u8) {
    for i in (0..8).rev() {
        let x = if ((*crc >> 15) ^ ((byte as u16 >> i) & 1)) != 0 { 0x1021 } else { 0 };
        *crc = (*crc << 1) ^ x;
    }
}

pub fn asc_to_bin(asc: &str) -> R<Vec<u8>> {
    let bank_h = |b: usize| if b % 2 == 1 { CRAM_H / 2 + 8 } else { CRAM_H };
    let mut cram: Vec<Vec<Vec<bool>>> = (0..4).map(|b| vec![vec![false; bank_h(b)]; CRAM_W]).collect();
    let mut bram: Vec<Vec<Vec<bool>>> = (0..4).map(|b| vec![vec![false; BRAM_H]; if b % 2 == 1 { BRAM_W / 2 } else { BRAM_W }]).collect();
    let mut initblop: Vec<u8> = vec![];
    let mut warmboot = true;
    let mut got_device = false;
    let lines: Vec<&str> = asc.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        i += 1;
        let p: Vec<&str> = line.split_whitespace().collect();
        let Some(&cmd) = p.first() else { continue };
        match cmd {
            ".comment" => {
                initblop = vec![0xff, 0x00];
                while i < lines.len() && !lines[i].starts_with('.') {
                    initblop.extend_from_slice(lines[i].as_bytes());
                    initblop.push(0);
                    i += 1;
                }
                initblop.extend_from_slice(&[0x00, 0xff]);
            }
            ".device" => {
                if p.get(1) != Some(&"5k") { return Err(format!("only the 5k device is supported, got {:?}", p.get(1))); }
                got_device = true;
            }
            ".warmboot" => warmboot = p.get(1) == Some(&"enabled"),
            ".sym" => {}
            ".extra_bit" => {
                let v: Vec<usize> = p[1..].iter().map(|s| s.parse().map_err(|_| "bad .extra_bit".to_string())).collect::<R<_>>()?;
                cram[v[0]][v[1]][v[2]] = true;
            }
            ".ram_data" => {
                let (tx, ty): (i32, i32) = (p[1].parse().map_err(|_| "bad .ram_data")?, p[2].parse().map_err(|_| "bad .ram_data")?);
                for by in 0..16 {
                    if i >= lines.len() || lines[i].starts_with('.') { break; }
                    let l = lines[i].as_bytes();
                    i += 1;
                    let mut bx = 256i32 - 4;
                    for &ch in l {
                        if bx < 0 { break; }
                        let v = (ch as char).to_digit(16).ok_or_else(|| format!("not a hex digit in .ram_data: {}", ch as char))?;
                        for k in 0..4 { if v & (1 << k) != 0 { let (b, x, y) = bram_index(tx, ty, (bx + k) as usize, by); bram[b][x][y] = true; } }
                        bx -= 4;
                    }
                }
            }
            c if c.ends_with("_tile") => {
                if !got_device { return Err("missing .device before tiles".into()); }
                let (tx, ty): (i32, i32) = (p[1].parse().map_err(|_| "bad tile")?, p[2].parse().map_err(|_| "bad tile")?);
                let tt = tile_type(tx, ty);
                if format!(".{}_tile", tt) != c { return Err(format!("{} for a {} tile at {} {}", c, tt, tx, ty)); }
                let w = tile_width(tt);
                for by in 0..16 {
                    if i >= lines.len() || lines[i].starts_with('.') { break; }
                    for (bx, ch) in lines[i].bytes().enumerate().take(w) {
                        if ch == b'1' { let (b, x, y) = cram_index(tx, ty, bx, by); cram[b][x][y] = true; }
                    }
                    i += 1;
                }
            }
            c => return Err(format!("unknown statement {}", c)),
        }
    }
    if !got_device { return Err("no .device".into()); }

    let mut out = initblop;
    let mut crc: u16 = 0;
    let w = |out: &mut Vec<u8>, crc: &mut u16, b: u8| { out.push(b); crc16(crc, b); };
    for b in [0x7E, 0xAA, 0x99, 0x7E, 0x51, 0x00, 0x01, 0x05] { w(&mut out, &mut crc, b); }
    crc = 0xffff;
    for b in [0x92, 0x00, if warmboot { 0x20 } else { 0x00 }] { w(&mut out, &mut crc, b); }
    for b in [0x62, ((CRAM_W - 1) >> 8) as u8, (CRAM_W - 1) as u8, 0x82, 0x00, 0x00] { w(&mut out, &mut crc, b); }
    for (bank, cols) in cram.iter().enumerate() {
        let h = bank_h(bank);
        for b in [0x72, (h >> 8) as u8, h as u8, 0x11, bank as u8, 0x01, 0x01] { w(&mut out, &mut crc, b); }
        let mut byte = 0u8;
        let mut n = 0;
        for y in 0..h {
            for col in cols.iter() {
                byte = (byte << 1) | col[y] as u8;
                n += 1;
                if n == 8 { w(&mut out, &mut crc, byte); byte = 0; n = 0; }
            }
        }
        w(&mut out, &mut crc, 0);
        w(&mut out, &mut crc, 0);
    }
    let chunk = 128usize;
    for b in [0x72, (chunk >> 8) as u8, chunk as u8] { w(&mut out, &mut crc, b); }
    for (bank, cols) in bram.iter().enumerate() {
        for b in [0x11, bank as u8] { w(&mut out, &mut crc, b); }
        let width = cols.len();
        let mut off = 0;
        while off < BRAM_H {
            for b in [0x82, (off >> 8) as u8, off as u8, 0x62, ((width - 1) >> 8) as u8, (width - 1) as u8, 0x01, 0x03] { w(&mut out, &mut crc, b); }
            let mut byte = 0u8;
            let mut n = 0;
            for y in 0..chunk {
                for col in cols.iter() {
                    byte = (byte << 1) | col[y + off] as u8;
                    n += 1;
                    if n == 8 { w(&mut out, &mut crc, byte); byte = 0; n = 0; }
                }
            }
            w(&mut out, &mut crc, 0);
            w(&mut out, &mut crc, 0);
            off += chunk;
        }
    }
    // the CRC covers the 0x22 command byte itself
    w(&mut out, &mut crc, 0x22);
    let c = crc;
    for b in [(c >> 8) as u8, c as u8, 0x01, 0x06, 0x00] { w(&mut out, &mut crc, b); }
    Ok(out)
}

/// `.bin` -> `.asc` for the iCE40UP5K: the read path (as IceStorm's
/// iceunpack): the bitstream's commands fill the configuration and block RAM
/// memories, which are then written out per tile, plus `.extra_bit`s (bits
/// outside the tiles, e.g. a pad driving a global network) and `.ram_data`.
pub fn bin_to_asc(bin: &[u8]) -> R<String> {
    let bank_h = |b: usize| if b % 2 == 1 { CRAM_H / 2 + 8 } else { CRAM_H };
    let mut cram: Vec<Vec<Vec<bool>>> = (0..4).map(|b| vec![vec![false; bank_h(b)]; CRAM_W]).collect();
    let mut bram: Vec<Vec<Vec<bool>>> = (0..4).map(|b| vec![vec![false; BRAM_H]; if b % 2 == 1 { BRAM_W / 2 } else { BRAM_W }]).collect();
    let start = bin.windows(4).position(|w| w == [0x7E, 0xAA, 0x99, 0x7E]).ok_or("not an iCE40 bitstream (no preamble)")? + 4;
    let (mut bank, mut width, mut height, mut offset) = (0usize, 0usize, 0usize, 0usize);
    let mut warmboot = false;
    let mut i = start;
    let byte = |i: usize| bin.get(i).copied().ok_or_else(|| "truncated bitstream".to_string());
    loop {
        let b = byte(i)?;
        i += 1;
        let (cmd, n) = (b >> 4, (b & 15) as usize);
        let mut value = 0usize;
        for _ in 0..n { value = (value << 8) | byte(i)? as usize; i += 1; }
        match cmd {
            0 => match value {
                1 | 3 => {
                    // CRAM (1) or BRAM (3) data: `height` rows of `width` bits, then two zero bytes
                    let mem = if value == 1 { &mut cram } else { &mut bram };
                    let cols = mem.get_mut(bank).ok_or("bad bank")?;
                    let bits = width * height;
                    for k in 0..bits {
                        let v = (byte(i + k / 8)? >> (7 - k % 8)) & 1 == 1;
                        let (x, y) = (k % width, k / width + offset);
                        if v {
                            let col = cols.get_mut(x).ok_or("data outside the memory")?;
                            *col.get_mut(y).ok_or("data outside the memory")? = true;
                        }
                    }
                    i += bits.div_ceil(8) + 2;
                }
                6 => break, // wake up
                _ => {}     // CRC reset, reboot, ...
            },
            1 => bank = value,
            6 => width = value + 1,
            7 => height = value,
            8 => offset = value,
            9 => warmboot = value & 0x20 != 0,
            _ => {} // CRC check, frequency range
        }
    }
    let mut s = String::from(".comment from veryl-eda (bin_to_asc)\n.device 5k\n");
    if !warmboot { s += ".warmboot disabled\n"; }
    let mut covered: Vec<Vec<Vec<bool>>> = (0..4).map(|b| vec![vec![false; bank_h(b)]; CRAM_W]).collect();
    for ty in 0..=CHIP_H + 1 {
        for tx in 0..=CHIP_W + 1 {
            let tt = tile_type(tx, ty);
            if tt == "corner" { continue; }
            s += &format!(".{}_tile {} {}\n", tt, tx, ty);
            for by in 0..16 {
                for bx in 0..tile_width(tt) {
                    let (b, x, y) = cram_index(tx, ty, bx, by);
                    covered[b][x][y] = true;
                    s.push(if cram[b][x][y] { '1' } else { '0' });
                }
                s.push('\n');
            }
        }
    }
    for (b, cols) in cram.iter().enumerate() {
        for (x, col) in cols.iter().enumerate() {
            for (y, v) in col.iter().enumerate() { if *v && !covered[b][x][y] { s += &format!(".extra_bit {} {} {}\n", b, x, y); } }
        }
    }
    for ty in 0..=CHIP_H + 1 {
        for tx in 0..=CHIP_W + 1 {
            if tile_type(tx, ty) != "ramb" { continue; }
            let mut lines = vec![];
            let mut any = false;
            for by in 0..16 {
                let mut l = String::new();
                let mut bx = 256i32 - 4;
                while bx >= 0 {
                    let mut v = 0u32;
                    for k in 0..4 { let (b, x, y) = bram_index(tx, ty, (bx + k) as usize, by); if bram[b][x][y] { v |= 1 << k; } }
                    any |= v != 0;
                    l.push(std::char::from_digit(v, 16).unwrap());
                    bx -= 4;
                }
                lines.push(l);
            }
            if any { s += &format!(".ram_data {} {}\n{}\n", tx, ty, lines.join("\n")); }
        }
    }
    Ok(s)
}
