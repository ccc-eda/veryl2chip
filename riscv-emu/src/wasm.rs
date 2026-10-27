//! The WebAssembly interface (wasm32, no imports): one machine per instance, bytes in and out
//! through a buffer (`rv_buf`); the IDE reads the RAM directly (`rv_ram`) for the screen and
//! the file exchange area. Used by web/src/rv_machine.ts.

use crate::{Machine, Stop, RAM_BASE};

static mut M: Option<Machine> = None;
static mut BUF: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
fn m() -> &'static mut Machine { unsafe { M.as_mut().expect("rv_init first") } }
#[allow(static_mut_refs)]
fn buf() -> &'static mut Vec<u8> { unsafe { &mut BUF } }

/// a machine with ram_mb MB of RAM
#[no_mangle]
pub extern "C" fn rv_init(ram_mb: u32) { unsafe { M = Some(Machine::new((ram_mb as usize) << 20)); } }

/// a buffer of n bytes for the next call's input (or the last call's output)
#[no_mangle]
pub extern "C" fn rv_buf(n: u32) -> *mut u8 { let b = buf(); if b.len() < n as usize { b.resize(n as usize, 0); } b.as_mut_ptr() }

#[no_mangle]
pub extern "C" fn rv_ram() -> *mut u8 { m().bus.ram.as_mut_ptr() }
#[no_mangle]
pub extern "C" fn rv_ram_len() -> u32 { m().bus.ram.len() as u32 }

/// the reset (the RAM is kept); rv_clear also clears the RAM
#[no_mangle]
pub extern "C" fn rv_reset() { m().reset(); }
#[no_mangle]
pub extern "C" fn rv_clear() { m().bus.ram.fill(0); m().reset(); }

/// n bytes of the buffer into the RAM at addr (0: done, 1: outside the RAM)
#[no_mangle]
pub extern "C" fn rv_load(addr: f64, n: u32) -> u32 { let b = buf()[..n as usize].to_vec(); m().load(addr as u64, &b).is_err() as u32 }

/// n bytes of the buffer typed into the UART
#[no_mangle]
pub extern "C" fn rv_input(n: u32) { let b = buf()[..n as usize].to_vec(); m().input(&b); }

#[no_mangle]
pub extern "C" fn rv_set_gpio(bits: u32) { m().set_gpio(bits); }
/// GPIO outputs (low 16 bits) and output enables (high 16 bits)
#[no_mangle]
pub extern "C" fn rv_gpio() -> u32 { let (o, e) = m().gpio_out(); (o & 0xffff) | e << 16 }

/// run up to n instructions: 0 = done, 1 = finished (finisher / tohost), 2 = idle (wfi, waiting for time or input),
/// 3 = a block to translate (rv_jit_code; then rv_jit_done)
#[no_mangle]
pub extern "C" fn rv_run(n: u32) -> u32 { match m().run(n as u64) { Stop::Count => 0, Stop::Finished => 1, Stop::Idle => 2, Stop::Jit => 3 } }

// ---- translation to WebAssembly (jit.rs): the host compiles the module, puts its "b" into the
// function table (a free slot from rv_jit_slot, else a new one) and says where (rv_jit_done) ----

/// translating on (hot: executions before a block is translated, 1 = the default) or off (0)
#[no_mangle]
pub extern "C" fn rv_jit(hot: u32) { let m = m(); m.jit.on = hot != 0; m.jit.hot_at = if hot > 1 { hot } else { 0 }; m.jit.clear(); }
/// the requested module into the buffer; its length
#[no_mangle]
pub extern "C" fn rv_jit_code() -> u32 {
    let b = buf();
    b.clear();
    if let Some((_, _, code, _)) = &m().jit.request { b.extend(code); }
    b.len() as u32
}
/// a table slot to reuse (-1: grow the table)
#[no_mangle]
pub extern "C" fn rv_jit_slot() -> i32 { m().jit.free.pop().map(|f| f as i32).unwrap_or(-1) }
#[no_mangle]
pub extern "C" fn rv_jit_done(slot: u32) { m().jit.install(slot); }
/// blocks translated, blocks run
#[no_mangle]
pub extern "C" fn rv_jit_stats(which: u32) -> f64 { let j = &m().jit; (if which == 0 { j.translated } else { j.blocks_run }) as f64 }

/// the translated code's helpers (imports "ld", "st", "ar" of its modules)
#[no_mangle]
pub extern "C" fn jit_ld(mp: *mut Machine, va: i64, f3: i32) -> i64 {
    let m = unsafe { &mut *mp };
    match m.jit_load(va as u64, f3 as u32) { Ok(v) => v as i64, Err(t) => { m.jit_fault = 1; m.jit.trap = Some(t); 0 } }
}
#[no_mangle]
pub extern "C" fn jit_st(mp: *mut Machine, va: i64, v: i64, f3: i32) {
    let m = unsafe { &mut *mp };
    match m.jit_store(va as u64, v as u64, f3 as u32) {
        Ok(()) => if m.jit.hit { m.jit.hit = false; m.jit_fault = 2; },
        Err(t) => { m.jit_fault = 1; m.jit.trap = Some(t); }
    }
}
#[no_mangle]
pub extern "C" fn jit_ar(a: i64, b: i64, kind: i32) -> i64 { Machine::arith(a as u64, b as u64, kind as u32) as i64 }

/// the UART's output since the last call into the buffer; its length
#[no_mangle]
pub extern "C" fn rv_output() -> u32 { let o = m().take_output(); let b = buf(); b.clear(); b.extend(&o); o.len() as u32 }

/// the finisher's code (0: still running); riscv-tests' tohost: 1 -> 0x5555 (pass), else 0x3333
#[no_mangle]
pub extern "C" fn rv_finished() -> u32 {
    let b = &m().bus;
    b.finished.unwrap_or(match b.tohost_val { 0 => 0, 1 => 0x5555, _ => 0x3333 })
}

/// a program of n bytes in the buffer: an ELF file by its segments (and its tohost), else at the RAM's start (0: done)
#[no_mangle]
pub extern "C" fn rv_load_program(n: u32) -> u32 { let b = buf()[..n as usize].to_vec(); m().load_program(&b).is_err() as u32 }

#[no_mangle]
pub extern "C" fn rv_instret() -> f64 { m().instret as f64 }
/// mtime follows a clock the caller sets (rv_set_time) instead of counting instructions
#[no_mangle]
pub extern "C" fn rv_set_realtime(on: u32) { m().realtime = on != 0; }
#[no_mangle]
pub extern "C" fn rv_time() -> f64 { m().bus.mtime as f64 }
#[no_mangle]
pub extern "C" fn rv_set_time(t: f64) { let m = m(); m.bus.mtime = m.bus.mtime.max(t as u64); m.wake(); }

/// the state (hart, devices, the non-zero 4 KB pages of the RAM) into the buffer; its length
#[no_mangle]
pub extern "C" fn rv_save() -> u32 {
    let m = m();
    let st = m.state();
    let b = buf();
    b.clear();
    b.extend(b"RVEM");
    b.extend((st.len() as u32).to_le_bytes());
    for w in &st { b.extend(w.to_le_bytes()); }
    for (i, p) in m.bus.ram.chunks(4096).enumerate() {
        if p.iter().any(|x| *x != 0) { b.extend((i as u32).to_le_bytes()); b.extend(p); }
    }
    b.len() as u32
}

/// back to a state from rv_save (n bytes in the buffer): 0 = done
#[no_mangle]
pub extern "C" fn rv_restore(n: u32) -> u32 {
    let b = buf()[..n as usize].to_vec();
    if n < 8 || &b[..4] != b"RVEM" { return 1; }
    let k = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
    let st: Vec<u64> = (0..k).map(|i| u64::from_le_bytes(b[8 + 8 * i..16 + 8 * i].try_into().unwrap())).collect();
    let m = m();
    m.bus.ram.fill(0);
    let mut at = 8 + 8 * k;
    while at + 4 + 4096 <= b.len() {
        let p = u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as usize * 4096;
        if p + 4096 <= m.bus.ram.len() { m.bus.ram[p..p + 4096].copy_from_slice(&b[at + 4..at + 4100]); }
        at += 4100;
    }
    m.reset();
    m.set_state(&st).is_err() as u32
}

/// the RAM's first address
#[no_mangle]
pub extern "C" fn rv_ram_base() -> f64 { RAM_BASE as f64 }
