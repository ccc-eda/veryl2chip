//! 4-state (0/1/x) bit vectors up to MAXW bits.

use std::cmp::Ordering;
use std::ops::{BitAnd, BitOr, BitXor, Not, Shl, Shr};

/// 64-bit words per value: MAXW = 64 × LIMBS bits
pub const LIMBS: usize = 4;
pub const MAXW: u32 = 64 * LIMBS as u32;

/// A fixed-width unsigned integer of MAXW bits (little-endian 64-bit words).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Hash)]
pub struct Bits(pub [u64; LIMBS]);

impl Bits {
    pub const ZERO: Bits = Bits([0; LIMBS]);
    pub fn from_u128(v: u128) -> Bits { let mut b = [0u64; LIMBS]; b[0] = v as u64; if LIMBS > 1 { b[1] = (v >> 64) as u64; } Bits(b) }
    /// the low 128 bits
    pub fn lo(&self) -> u128 { self.0[0] as u128 | if LIMBS > 1 { (self.0[1] as u128) << 64 } else { 0 } }
    /// as an index or count: u128::MAX when it does not fit
    pub fn sat(&self) -> u128 { if self.0[2..].iter().any(|w| *w != 0) { u128::MAX } else { self.lo() } }
    pub fn is_zero(&self) -> bool { self.0.iter().all(|w| *w == 0) }
    pub fn bit(&self, k: u32) -> bool { k < MAXW && (self.0[(k / 64) as usize] >> (k % 64)) & 1 == 1 }
    pub fn count_ones(&self) -> u32 { self.0.iter().map(|w| w.count_ones()).sum() }
    pub fn leading_zeros(&self) -> u32 {
        for i in (0..LIMBS).rev() { if self.0[i] != 0 { return (LIMBS - 1 - i) as u32 * 64 + self.0[i].leading_zeros(); } }
        MAXW
    }
    pub fn wrapping_add(self, o: Bits) -> Bits {
        let mut r = [0u64; LIMBS];
        let mut c = 0u64;
        for i in 0..LIMBS { let (s1, c1) = self.0[i].overflowing_add(o.0[i]); let (s2, c2) = s1.overflowing_add(c); r[i] = s2; c = (c1 | c2) as u64; }
        Bits(r)
    }
    pub fn wrapping_neg(self) -> Bits { (!self).wrapping_add(Bits::from_u128(1)) }
    pub fn wrapping_sub(self, o: Bits) -> Bits { self.wrapping_add(o.wrapping_neg()) }
    pub fn wrapping_mul(self, o: Bits) -> Bits {
        let mut r = [0u64; LIMBS];
        for i in 0..LIMBS {
            let mut c = 0u128;
            for j in 0..LIMBS - i {
                let t = self.0[i] as u128 * o.0[j] as u128 + r[i + j] as u128 + c;
                r[i + j] = t as u64;
                c = t >> 64;
            }
        }
        Bits(r)
    }
    /// unsigned quotient and remainder (o != 0)
    pub fn divrem(self, o: Bits) -> (Bits, Bits) {
        if LIMBS <= 2 || (self.0[2..].iter().all(|w| *w == 0) && o.0[2..].iter().all(|w| *w == 0)) {
            let (a, b) = (self.lo(), o.lo());
            return (Bits::from_u128(a / b), Bits::from_u128(a % b));
        }
        let (mut q, mut r) = (Bits::ZERO, Bits::ZERO);
        for k in (0..MAXW - self.leading_zeros()).rev() {
            r = r << 1;
            if self.bit(k) { r.0[0] |= 1; }
            if r >= o { r = r.wrapping_sub(o); q.0[(k / 64) as usize] |= 1 << (k % 64); }
        }
        (q, r)
    }
    pub fn to_dec(self) -> String {
        if LIMBS <= 2 || self.0[2..].iter().all(|w| *w == 0) { return self.lo().to_string(); }
        let ten = Bits::from_u128(10_000_000_000_000_000_000);
        let mut parts = vec![];
        let mut v = self;
        while !v.is_zero() { let (q, r) = v.divrem(ten); parts.push(r.lo()); v = q; }
        let mut s = parts.pop().unwrap().to_string();
        while let Some(p) = parts.pop() { s += &format!("{:019}", p); }
        s
    }
}

pub fn mask(w: u32) -> Bits {
    let mut b = [0u64; LIMBS];
    for (i, word) in b.iter_mut().enumerate() {
        let lo = i as u32 * 64;
        *word = if w >= lo + 64 { u64::MAX } else if w > lo { (1u64 << (w - lo)) - 1 } else { 0 };
    }
    Bits(b)
}

impl From<u128> for Bits { fn from(v: u128) -> Bits { Bits::from_u128(v) } }
impl BitAnd for Bits { type Output = Bits; fn bitand(self, o: Bits) -> Bits { let mut r = self.0; for i in 0..LIMBS { r[i] &= o.0[i]; } Bits(r) } }
impl BitOr for Bits { type Output = Bits; fn bitor(self, o: Bits) -> Bits { let mut r = self.0; for i in 0..LIMBS { r[i] |= o.0[i]; } Bits(r) } }
impl BitXor for Bits { type Output = Bits; fn bitxor(self, o: Bits) -> Bits { let mut r = self.0; for i in 0..LIMBS { r[i] ^= o.0[i]; } Bits(r) } }
impl Not for Bits { type Output = Bits; fn not(self) -> Bits { let mut r = self.0; for w in r.iter_mut() { *w = !*w; } Bits(r) } }
impl BitAnd<u128> for Bits { type Output = Bits; fn bitand(self, o: u128) -> Bits { self & Bits::from_u128(o) } }
impl BitOr<u128> for Bits { type Output = Bits; fn bitor(self, o: u128) -> Bits { self | Bits::from_u128(o) } }
impl Shl<u32> for Bits {
    type Output = Bits;
    fn shl(self, n: u32) -> Bits {
        if n >= MAXW { return Bits::ZERO; }
        let (w, b) = ((n / 64) as usize, n % 64);
        let mut r = [0u64; LIMBS];
        for i in (w..LIMBS).rev() {
            r[i] = self.0[i - w] << b;
            if b > 0 && i > w { r[i] |= self.0[i - w - 1] >> (64 - b); }
        }
        Bits(r)
    }
}
impl Shr<u32> for Bits {
    type Output = Bits;
    fn shr(self, n: u32) -> Bits {
        if n >= MAXW { return Bits::ZERO; }
        let (w, b) = ((n / 64) as usize, n % 64);
        let mut r = [0u64; LIMBS];
        for i in 0..LIMBS - w {
            r[i] = self.0[i + w] >> b;
            if b > 0 && i + w + 1 < LIMBS { r[i] |= self.0[i + w + 1] << (64 - b); }
        }
        Bits(r)
    }
}
impl PartialOrd for Bits { fn partial_cmp(&self, o: &Bits) -> Option<Ordering> { Some(self.cmp(o)) } }
impl Ord for Bits {
    fn cmp(&self, o: &Bits) -> Ordering {
        for i in (0..LIMBS).rev() { match self.0[i].cmp(&o.0[i]) { Ordering::Equal => continue, x => return x } }
        Ordering::Equal
    }
}
impl PartialEq<u128> for Bits { fn eq(&self, o: &u128) -> bool { *self == Bits::from_u128(*o) } }
impl PartialOrd<u128> for Bits { fn partial_cmp(&self, o: &u128) -> Option<Ordering> { Some(self.cmp(&Bits::from_u128(*o))) } }

/// Invariant: wherever an `x` bit is set, the matching `v` bit is 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Val {
    pub w: u32,
    pub v: Bits,
    pub x: Bits,
    pub s: bool,
}

impl Val {
    pub fn new(w: u32, v: u128) -> Self { Val::of(w, Bits::from_u128(v)) }
    pub fn of(w: u32, v: Bits) -> Self {
        let w = w.clamp(1, MAXW);
        Val { w, v: v & mask(w), x: Bits::ZERO, s: false }
    }
    pub fn allx(w: u32) -> Self {
        let w = w.clamp(1, MAXW);
        Val { w, v: Bits::ZERO, x: mask(w), s: false }
    }
    pub fn bit(b: bool) -> Self { Val::new(1, b as u128) }
    pub fn signed(mut self, s: bool) -> Self { self.s = s; self }

    /// Some(true) if any bit is a known 1, Some(false) if all bits are known 0, else None (x).
    pub fn truth(&self) -> Option<bool> {
        if !self.v.is_zero() { Some(true) } else if self.x.is_zero() { Some(false) } else { None }
    }

    pub fn resize(&self, w: u32) -> Val {
        let w = w.clamp(1, MAXW);
        if w <= self.w {
            return Val { w, v: self.v & mask(w), x: self.x & mask(w), s: self.s };
        }
        let ext = mask(w) & !mask(self.w);
        let (mut v, mut x) = (self.v, self.x);
        if self.s {
            if self.v.bit(self.w - 1) { v = v | ext } else if self.x.bit(self.w - 1) { x = x | ext }
        }
        Val { w, v, x, s: self.s }
    }

    /// sign bit set (signed values)
    pub fn negative(&self) -> bool { self.s && self.v.bit(self.w - 1) }

    /// two's complement order of two signed values of the same width
    pub fn scmp(&self, o: &Val) -> Ordering {
        match (self.negative(), o.negative()) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => self.v.cmp(&o.v),
        }
    }

    /// magnitude of a signed value (for signed division)
    pub fn abs(&self) -> Bits { if self.negative() { self.v.wrapping_neg() & mask(self.w) } else { self.v } }

    pub fn to_i128(&self) -> i128 {
        if self.s && self.w <= 128 && self.v.bit(self.w - 1) {
            (self.v.lo() | !mask(self.w).lo()) as i128
        } else {
            self.v.lo() as i128
        }
    }

    pub fn fmt_bin(&self) -> String {
        (0..self.w).rev().map(|i| {
            if self.x.bit(i) { 'x' } else if self.v.bit(i) { '1' } else { '0' }
        }).collect()
    }

    pub fn fmt_hex(&self) -> String {
        let n = self.w.div_ceil(4);
        (0..n).rev().map(|i| {
            let sh = i * 4;
            let valid = mask((self.w - sh).min(4)).lo() as u32;
            let xm = ((self.x >> sh).lo() & 0xf) as u32;
            let vv = ((self.v >> sh).lo() & 0xf) as u32;
            if xm == valid { 'x' } else if xm != 0 { 'X' } else { std::char::from_digit(vv, 16).unwrap() }
        }).collect()
    }

    pub fn fmt_oct(&self) -> String {
        if !self.x.is_zero() { return "x".into(); }
        let n = self.w.div_ceil(3);
        (0..n).rev().map(|i| std::char::from_digit(((self.v >> (i * 3)).lo() & 7) as u32, 8).unwrap()).collect()
    }

    pub fn fmt_dec(&self) -> String {
        if !self.x.is_zero() {
            return if self.x == mask(self.w) { "x".into() } else { "X".into() };
        }
        if self.negative() { format!("-{}", self.abs().to_dec()) } else { self.v.to_dec() }
    }
}
