//! rvemu: run a program on riscv-emu's Rv64Soc, like the Verilator bench (sim/main.cpp) and
//! veryl-emu's (emu/rv64emu.mjs) in examples/rv64:
//!
//!   rvemu [-t] [-r] [-m N] [-l ADDR:FILE]... [-d ADDR:LEN:FILE]... [-s SCRIPT] PROG
//!
//!   PROG            an ELF file (its segments; tohost for riscv-tests), else a binary at 0x8000_0000
//!   -t              a line per instruction, in the format of `spike -l --log-commits`
//!   -m N            at most N instructions (default 10 G; 0 = no limit)
//!   -l ADDR:FILE    another file into the RAM (the exchange area, a file system image)
//!   -d ADDR:LEN:FILE  the RAM from ADDR into FILE at the end
//!   -s SCRIPT       each time the program prints the shell prompt "$ ", type the script's next line;
//!                   "!gpio N=V" lines set GPIO input N; after the last line, the next prompt ends the run
//!   -r              real time: mtime follows the clock (10 MHz) instead of counting instructions
//!                   (the default when typing at a terminal)
//!
//! UART output goes to stdout, the terminal's keys to the UART (Ctrl-C ends rvemu); GPIO
//! output changes print "[gpio] out=…" on stderr after the UART's current line.
//! Exit code: 0 pass (finisher 0x5555, tohost 1, script done), 1 fail, 2 out of instructions.

use riscv_emu::{Machine, Stop, RAM_BASE, RAM_SIZE};
use std::io::{IsTerminal, Read, Write};
use std::time::Instant;

fn usage() -> ! {
    eprintln!("usage: rvemu [-t] [-r] [-m N] [-l ADDR:FILE]... [-d ADDR:LEN:FILE]... [-s SCRIPT] PROG");
    std::process::exit(1)
}

fn num(s: &str) -> u64 {
    let s = s.trim();
    let r = if let Some(h) = s.strip_prefix("0x") { u64::from_str_radix(&h.replace('_', ""), 16) } else { s.replace('_', "").parse() };
    r.unwrap_or_else(|_| usage())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut trace, mut realtime, mut max, mut prog) = (false, None::<bool>, 10_000_000_000u64, None::<String>);
    let (mut loads, mut dumps, mut script) = (vec![], vec![], None::<Vec<String>>);
    let mut a = args.iter();
    while let Some(x) = a.next() {
        match x.as_str() {
            "-t" => trace = true,
            "-r" => realtime = Some(true),
            "-m" => { max = num(a.next().unwrap_or_else(|| usage())); if max == 0 { max = u64::MAX; } }
            "-l" => { let v = a.next().unwrap_or_else(|| usage()); let (ad, f) = v.split_once(':').unwrap_or_else(|| usage()); loads.push((num(ad), f.to_string())); }
            "-d" => {
                let v = a.next().unwrap_or_else(|| usage());
                let p: Vec<&str> = v.splitn(3, ':').collect();
                if p.len() != 3 { usage(); }
                dumps.push((num(p[0]), num(p[1]) as usize, p[2].to_string()));
            }
            "-s" => {
                let f = a.next().unwrap_or_else(|| usage());
                let t = std::fs::read_to_string(f).unwrap_or_else(|e| { eprintln!("{}: {}", f, e); std::process::exit(1) });
                script = Some(t.lines().map(|l| l.to_string()).collect());
            }
            f if !f.starts_with('-') => prog = Some(f.to_string()),
            _ => usage(),
        }
    }
    let Some(prog) = prog else { usage() };
    let mut m = Machine::new(RAM_SIZE);
    let bytes = std::fs::read(&prog).unwrap_or_else(|e| { eprintln!("{}: {}", prog, e); std::process::exit(1) });
    m.load_program(&bytes).unwrap_or_else(|e| { eprintln!("{}: {}", prog, e); std::process::exit(1) });
    for (ad, f) in &loads {
        let b = std::fs::read(f).unwrap_or_else(|e| { eprintln!("{}: {}", f, e); std::process::exit(1) });
        m.load(*ad, &b).unwrap_or_else(|e| { eprintln!("{}: {}", f, e); std::process::exit(1) });
    }
    let scripted = script.is_some();
    let tty = !scripted && std::io::stdin().is_terminal();
    let realtime = realtime.unwrap_or(tty);
    m.realtime = realtime;

    // the terminal: raw, keys from a thread
    let (ktx, krx) = std::sync::mpsc::channel::<u8>();
    if !scripted {
        if tty { let _ = std::process::Command::new("stty").args(["raw", "-echo"]).stdin(std::process::Stdio::inherit()).status(); }
        std::thread::spawn(move || {
            let mut b = [0u8; 1];
            while let Ok(1) = std::io::stdin().read(&mut b) { if ktx.send(if b[0] == 10 { 13 } else { b[0] }).is_err() { break; } }
        });
    }
    let restore = move || { if tty { let _ = std::process::Command::new("stty").arg("sane").stdin(std::process::Stdio::inherit()).status(); } };

    let out = std::io::stdout();
    let mut out = out.lock();
    let t0 = Instant::now();
    let mut code = 2;
    let (mut next_line, mut last, mut gpio_seen, mut gpio_note) = (0usize, 0u8, (0u32, 0u32), None::<String>);
    let mut tail: Vec<u8> = vec![];
    let start = m.instret;
    'run: while m.instret - start < max {
        if realtime { m.bus.mtime = m.bus.mtime.max((t0.elapsed().as_nanos() / 100) as u64); }
        let slice = if trace { 1 } else { 100_000.min(max - (m.instret - start)) };
        let before = m.instret;
        let mut stop = m.run(slice);
        if trace && stop == Stop::Count && (m.bus.finished.is_some() || m.bus.tohost_val != 0) { stop = Stop::Finished; }
        if trace && m.instret > before {
            let (i, pc, prv) = (m.last_insn, m.last_pc, m.last_prv);
            let mut l = if i & 3 != 3 { format!("core   0: {} 0x{:016x} (0x{:04x})", prv, pc, i) } else { format!("core   0: {} 0x{:016x} (0x{:08x})", prv, pc, i) };
            if let Some((rd, v)) = m.last_wr { l += &format!(" x{:<2} 0x{:016x}", rd, v); }
            let _ = writeln!(out, "{}", l);
        }
        for c in m.take_output() {
            let _ = out.write_all(&[c]);
            last = c;
            if let (b'\n', Some(n)) = (c, gpio_note.take()) { let _ = out.flush(); eprint!("{}", n); }
            if let Some(s) = &script {
                tail.push(c);
                if tail.len() > 2 { tail.remove(0); }
                if tail == b"$ " {
                    while next_line < s.len() && s[next_line].starts_with("!gpio ") {
                        let (n, v) = s[next_line][6..].split_once('=').unwrap_or(("0", "0"));
                        let (n, v) = (num(n) as u32, num(v));
                        let bits = if v != 0 { m.bus.gpio.pins_in | 1 << n } else { m.bus.gpio.pins_in & !(1 << n) };
                        m.set_gpio(bits);
                        let _ = out.flush();
                        eprintln!("[gpio] in=0x{:04x}", bits);
                        next_line += 1;
                    }
                    if next_line < s.len() { let mut l = s[next_line].clone().into_bytes(); l.push(13); m.input(&l); next_line += 1; }
                    else { code = 0; break 'run; }
                }
            }
        }
        let g = m.gpio_out();
        let g = (g.0 & g.1, 0);
        if g != gpio_seen {
            gpio_seen = g;
            let n = format!("[gpio] out=0x{:04x}\n", g.0);
            if last == b'\n' || last == 0 { let _ = out.flush(); eprint!("{}", n); } else { gpio_note = Some(n); }
        }
        if !scripted {
            let mut keys = vec![];
            while let Ok(k) = krx.try_recv() { if k == 3 { restore(); eprintln!(); std::process::exit(130); } keys.push(k); }
            if !keys.is_empty() { m.input(&keys); }
            let _ = out.flush();
        }
        match stop {
            Stop::Finished => {
                if let Some(v) = m.bus.finished { code = if v & 0xffff == 0x5555 { 0 } else { let _ = out.flush(); eprintln!("finisher: 0x{:x}", v); 1 }; }
                else {
                    let v = m.bus.tohost_val;
                    code = if v == 1 { 0 } else { let _ = out.flush(); eprintln!("FAIL: test {} (tohost = 0x{:x})", v >> 1, v); 1 };
                }
                break;
            }
            Stop::Idle => {
                if realtime || tty { std::thread::sleep(std::time::Duration::from_millis(1)); }
                else if m.bus.rx.is_empty() && !scripted { break; }
                else if m.bus.rx.is_empty() { let _ = out.flush(); eprintln!("\nidle: nothing more will happen"); code = 1; break; }
            }
            Stop::Count => {}
        }
    }
    let _ = out.flush();
    if let Some(n) = gpio_note { eprint!("{}", n); }
    for (ad, len, f) in &dumps {
        let o = (ad - RAM_BASE) as usize;
        std::fs::write(f, &m.bus.ram[o..o + len]).unwrap_or_else(|e| eprintln!("{}: {}", f, e));
    }
    restore();
    let sec = t0.elapsed().as_secs_f64();
    let n = m.instret - start;
    let speed = format!("{:.1} s, {:.1} MIPS", sec, n as f64 / sec / 1e6);
    match code {
        2 => eprintln!("\nTIMEOUT after {} instructions ({})", n, speed),
        0 => eprintln!("\nPASS after {} instructions ({})", n, speed),
        _ => eprintln!("\nFAIL after {} instructions ({})", n, speed),
    }
    std::process::exit(code);
}
