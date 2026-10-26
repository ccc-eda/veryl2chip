//! Peripherals that must see every clock cycle, so they live inside the
//! board's simulation loop: the USB serial port (both directions), multiplexed
//! seven-segment displays and a VGA monitor. Slow parts (LEDs, buttons,
//! switches, a buzzer's pitch) only need per-pin duty and edge counts.

use std::collections::VecDeque;

/// The FTDI serial port: decodes the FPGA's TX into bytes and sends queued
/// bytes on its RX; 8N1, `cpb` clock cycles per bit.
pub struct Uart {
    pub tx: Option<u32>,
    pub rx: Option<u32>,
    pub cpb: f64,
    /// receiving: cycles since the start bit's falling edge, bits so far
    rx_t: Option<u64>,
    rx_byte: u16,
    prev: bool,
    /// bytes the FPGA sent, not yet taken
    pub received: Vec<u8>,
    /// bytes to send to the FPGA, and the one being sent (with its start cycle)
    pub queue: VecDeque<u8>,
    sending: Option<(u8, u64)>,
    pub framing_errors: u32,
}

impl Uart {
    pub fn new(tx: Option<u32>, rx: Option<u32>, cpb: f64) -> Uart {
        Uart { tx, rx, cpb: cpb.max(2.0), rx_t: None, rx_byte: 0, prev: true, received: vec![], queue: VecDeque::new(), sending: None, framing_errors: 0 }
    }

    /// the level the serial line drives into the FPGA during cycle `t` of the sender
    pub fn rx_level(&mut self, now: u64) -> Option<bool> {
        self.rx?;
        if self.sending.is_none() {
            let b = self.queue.pop_front()?;
            self.sending = Some((b, now));
        }
        let (b, t0) = self.sending.unwrap();
        let k = ((now - t0) as f64 / self.cpb) as u64;
        // start bit, 8 data bits (lsb first), stop bit, then idle
        Some(match k { 0 => false, 1..=8 => (b >> (k - 1)) & 1 == 1, 9 => true, _ => { self.sending = None; return self.rx_level(now); } })
    }

    /// sample the FPGA's TX once per cycle
    pub fn sample(&mut self, level: bool) {
        match self.rx_t {
            None => {
                if self.prev && !level { self.rx_t = Some(0); self.rx_byte = 0; }
            }
            Some(t) => {
                let t = t + 1;
                self.rx_t = Some(t);
                // the middle of bit k (k = 0: start bit) is at (k + 0.5) bit times
                // (round, not floor: at a fractional bit time t / cpb - 0.5 can fall just short of k)
                let k = (t as f64 / self.cpb - 0.5).round();
                let at_mid = ((k + 0.5) * self.cpb).round() as u64 == t;
                if at_mid && k >= 1.0 && k <= 8.0 && level { self.rx_byte |= 1 << (k as u32 - 1); }
                if at_mid && k >= 9.0 {
                    if level { self.received.push(self.rx_byte as u8); } else { self.framing_errors += 1; }
                    self.rx_t = None;
                }
            }
        }
        self.prev = level;
    }
}

/// Multiplexed seven-segment display: per digit, per segment, the cycles it was lit
pub struct Seg {
    /// a..g, dp output nets (None: not connected)
    pub segs: [Option<u32>; 8],
    /// digit selects: (net, level that selects the digit); a single digit with no select is always on
    pub sels: Vec<(Option<u32>, bool)>,
    /// the level that lights a segment
    pub on: bool,
    pub lit: Vec<[u64; 8]>,
}

/// VGA monitor: one pixel per clock; a line starts at HSYNC's active edge, a frame at VSYNC's
pub struct Vga {
    pub hs: Option<u32>,
    pub vs: Option<u32>,
    /// color pins, most significant bit first
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
    /// sync pulses are active low (as in 640×480)
    pub active_low: bool,
    prev_hs: bool,
    prev_vs: bool,
    line: Vec<u16>,
    lines: Vec<Vec<u16>>,
    /// the last complete frame: (width, height, 12-bit pixels)
    pub frame: Option<(usize, usize, Vec<u16>)>,
    pub frames: u64,
}

const MAX_W: usize = 2048;
const MAX_H: usize = 1024;

impl Vga {
    pub fn new(hs: Option<u32>, vs: Option<u32>, r: Vec<u32>, g: Vec<u32>, b: Vec<u32>) -> Vga {
        Vga { hs, vs, r, g, b, active_low: true, prev_hs: true, prev_vs: true, line: vec![], lines: vec![], frame: None, frames: 0 }
    }

    /// channel value scaled to 4 bits from the pins that are connected
    fn chan(pins: &[u32], v: &[u8]) -> u16 {
        if pins.is_empty() { return 0; }
        let n = pins.len() as u32;
        let x = pins.iter().fold(0u32, |a, p| (a << 1) | v[*p as usize] as u32);
        ((x * 15 + ((1 << n) - 1) / 2) / ((1 << n) - 1)) as u16
    }

    pub fn sample(&mut self, v: &[u8]) {
        let level = |n: Option<u32>| n.map(|n| v[n as usize] != 0).unwrap_or(!false);
        let (hs, vs) = (level(self.hs), level(self.vs));
        let act = |prev: bool, now: bool, low: bool| if low { prev && !now } else { !prev && now };
        if act(self.prev_hs, hs, self.active_low) {
            let l = std::mem::take(&mut self.line);
            if self.lines.len() < MAX_H { self.lines.push(l); }
        }
        if act(self.prev_vs, vs, self.active_low) {
            let lines = std::mem::take(&mut self.lines);
            let w = lines.iter().map(|l| l.len()).max().unwrap_or(0);
            if w > 0 && !lines.is_empty() {
                let mut px = vec![0u16; w * lines.len()];
                for (y, l) in lines.iter().enumerate() { px[y * w..y * w + l.len()].copy_from_slice(l); }
                self.frame = Some((w, lines.len(), px));
                self.frames += 1;
            }
        }
        self.prev_hs = hs;
        self.prev_vs = vs;
        if self.line.len() < MAX_W {
            let c = Self::chan(&self.r, v) << 8 | Self::chan(&self.g, v) << 4 | Self::chan(&self.b, v);
            self.line.push(c);
        }
    }
}

/// The frame VgaText (examples/src/rvvga.veryl) shows, laid out like the monitor records the
/// hardware's (800 × 525 from the HSYNC / VSYNC edges: the visible 640 × 480 at x 144, y 35)
pub fn text_frame(vram: &[u8], font: &[u8], colors: u32) -> (usize, usize, Vec<u16>) {
    let (w, h) = (800usize, 525usize);
    let (fg, bg) = ((colors & 0xfff) as u16, ((colors >> 16) & 0xfff) as u16);
    let mut px = vec![0u16; w * h];
    for y in 0..480 {
        for x in 0..640 {
            let c = vram[(y / 16) * 40 + x / 16] as usize & 127;
            let bits = font[c * 8 + (y / 2) % 8];
            px[(y + 35) * w + x + 144] = if (bits << ((x / 2) % 8)) & 0x80 != 0 { fg } else { bg };
        }
    }
    (w, h, px)
}

/// run-length encoding of 12-bit pixels: (color, count) pairs as little-endian u16s
pub fn rle(px: &[u16]) -> Vec<u8> {
    let mut out = vec![];
    let mut i = 0;
    while i < px.len() {
        let c = px[i];
        let mut n = 1;
        while i + n < px.len() && px[i + n] == c && n < 0xffff { n += 1; }
        out.extend_from_slice(&c.to_le_bytes());
        out.extend_from_slice(&(n as u16).to_le_bytes());
        i += n;
    }
    out
}
