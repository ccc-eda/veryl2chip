//! Constant values (up to 128 bits) for parameters, literals and enum members.

pub fn mask(w: u32) -> u128 {
    if w >= 128 { u128::MAX } else { (1u128 << w) - 1 }
}

/// `x` marks unknown bits (from 'x / 8'hx literals); synthesis treats them as 0.
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
}
