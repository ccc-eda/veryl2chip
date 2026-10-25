//! 4-state (0/1/x) bit vectors up to 128 bits.

pub fn mask(w: u32) -> u128 {
    if w >= 128 { u128::MAX } else { (1u128 << w) - 1 }
}

/// Invariant: wherever an `x` bit is set, the matching `v` bit is 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Val {
    pub w: u32,
    pub v: u128,
    pub x: u128,
    pub s: bool,
}

impl Val {
    pub fn new(w: u32, v: u128) -> Self {
        let w = w.clamp(1, 128);
        Val { w, v: v & mask(w), x: 0, s: false }
    }
    pub fn allx(w: u32) -> Self {
        let w = w.clamp(1, 128);
        Val { w, v: 0, x: mask(w), s: false }
    }
    pub fn bit(b: bool) -> Self { Val::new(1, b as u128) }
    pub fn signed(mut self, s: bool) -> Self { self.s = s; self }

    /// Some(true) if any bit is a known 1, Some(false) if all bits are known 0, else None (x).
    pub fn truth(&self) -> Option<bool> {
        if self.v != 0 { Some(true) } else if self.x == 0 { Some(false) } else { None }
    }

    pub fn resize(&self, w: u32) -> Val {
        let w = w.clamp(1, 128);
        if w <= self.w {
            return Val { w, v: self.v & mask(w), x: self.x & mask(w), s: self.s };
        }
        let ext = mask(w) & !mask(self.w);
        let msb = 1u128 << (self.w - 1);
        let (mut v, mut x) = (self.v, self.x);
        if self.s {
            if self.v & msb != 0 { v |= ext } else if self.x & msb != 0 { x |= ext }
        }
        Val { w, v, x, s: self.s }
    }

    pub fn to_i128(&self) -> i128 {
        if self.s && self.w < 128 && (self.v >> (self.w - 1)) & 1 == 1 {
            (self.v | !mask(self.w)) as i128
        } else {
            self.v as i128
        }
    }

    pub fn fmt_bin(&self) -> String {
        (0..self.w).rev().map(|i| {
            if (self.x >> i) & 1 == 1 { 'x' } else if (self.v >> i) & 1 == 1 { '1' } else { '0' }
        }).collect()
    }

    pub fn fmt_hex(&self) -> String {
        let n = (self.w + 3) / 4;
        (0..n).rev().map(|i| {
            let sh = i * 4;
            let valid = mask((self.w - sh).min(4)) as u32;
            let xm = ((self.x >> sh) & 0xf) as u32;
            let vv = ((self.v >> sh) & 0xf) as u32;
            if xm == valid { 'x' } else if xm != 0 { 'X' } else { std::char::from_digit(vv, 16).unwrap() }
        }).collect()
    }

    pub fn fmt_oct(&self) -> String {
        if self.x != 0 { return "x".into(); }
        let n = ((self.w + 2) / 3) as usize;
        format!("{:0n$o}", self.v, n = n)
    }

    pub fn fmt_dec(&self) -> String {
        if self.x != 0 {
            return if self.x == mask(self.w) { "x".into() } else { "X".into() };
        }
        if self.s { self.to_i128().to_string() } else { self.v.to_string() }
    }
}
