//! The iCEBreaker board (iCE40UP5K-SG48): what is connected to which pin,
//! after the board's official pinout.

/// what a pin is on the board
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// the 12 MHz oscillator
    Clock,
    /// a push button; `pressed` is the level it drives when pressed (released = the other)
    Button { pressed: bool },
    /// an LED; `on` is the level that lights it
    Led { on: bool },
    /// the FTDI serial port: true = into the FPGA (RX), false = from it (TX)
    Uart { rx: bool },
    /// a PMOD header pin (nothing on the board itself)
    Pmod,
}

pub struct Pin { pub pin: u32, pub name: &'static str, pub kind: Kind }

pub const CLOCK_PIN: u32 = 35;
pub const CLOCK_HZ: f64 = 12e6;

pub const PINS: &[Pin] = &[
    Pin { pin: 35, name: "CLK", kind: Kind::Clock },
    Pin { pin: 10, name: "BTN_N", kind: Kind::Button { pressed: false } },
    Pin { pin: 11, name: "LEDR_N", kind: Kind::Led { on: false } },
    Pin { pin: 37, name: "LEDG_N", kind: Kind::Led { on: false } },
    Pin { pin: 6, name: "RX", kind: Kind::Uart { rx: true } },
    Pin { pin: 9, name: "TX", kind: Kind::Uart { rx: false } },
    // break-off section (PMOD2): five LEDs and three buttons
    Pin { pin: 26, name: "LED1", kind: Kind::Led { on: true } },
    Pin { pin: 27, name: "LED2", kind: Kind::Led { on: true } },
    Pin { pin: 25, name: "LED3", kind: Kind::Led { on: true } },
    Pin { pin: 23, name: "LED4", kind: Kind::Led { on: true } },
    Pin { pin: 21, name: "LED5", kind: Kind::Led { on: true } },
    Pin { pin: 20, name: "BTN1", kind: Kind::Button { pressed: true } },
    Pin { pin: 19, name: "BTN2", kind: Kind::Button { pressed: true } },
    Pin { pin: 18, name: "BTN3", kind: Kind::Button { pressed: true } },
    // PMOD1A and PMOD1B (pins 1-4, 7-10 of each header)
    Pin { pin: 4, name: "P1A1", kind: Kind::Pmod }, Pin { pin: 2, name: "P1A2", kind: Kind::Pmod },
    Pin { pin: 47, name: "P1A3", kind: Kind::Pmod }, Pin { pin: 45, name: "P1A4", kind: Kind::Pmod },
    Pin { pin: 3, name: "P1A7", kind: Kind::Pmod }, Pin { pin: 48, name: "P1A8", kind: Kind::Pmod },
    Pin { pin: 46, name: "P1A9", kind: Kind::Pmod }, Pin { pin: 44, name: "P1A10", kind: Kind::Pmod },
    Pin { pin: 43, name: "P1B1", kind: Kind::Pmod }, Pin { pin: 38, name: "P1B2", kind: Kind::Pmod },
    Pin { pin: 34, name: "P1B3", kind: Kind::Pmod }, Pin { pin: 31, name: "P1B4", kind: Kind::Pmod },
    Pin { pin: 42, name: "P1B7", kind: Kind::Pmod }, Pin { pin: 36, name: "P1B8", kind: Kind::Pmod },
    Pin { pin: 32, name: "P1B9", kind: Kind::Pmod }, Pin { pin: 28, name: "P1B10", kind: Kind::Pmod },
];

pub fn pin(n: u32) -> Option<&'static Pin> { PINS.iter().find(|p| p.pin == n) }

/// the pin file used when a project has none (the tutorial's: board LEDs and buttons)
pub const DEFAULT_PCF: &str = include_str!("icebreaker.pcf");

/// `d` on an iCEBreaker: pins from `pcf` (the default pin file without one),
/// buttons released, the serial line idle
pub fn board(d: super::Design, pcf: Option<&str>) -> Result<super::Board, String> {
    let mut b = super::Board::new(d, pcf.unwrap_or(DEFAULT_PCF), CLOCK_PIN)?;
    for p in PINS {
        match p.kind {
            Kind::Button { pressed } => b.set_pin(p.pin, !pressed),
            Kind::Uart { rx: true } => b.set_pin(p.pin, true),
            _ => {}
        }
        let is_in = b.pin_in.contains_key(&p.pin);
        let is_out = b.pin_out.iter().any(|x| x.0 == p.pin);
        match p.kind {
            Kind::Led { .. } | Kind::Uart { rx: false } if is_in => b.warnings.push(format!("pin {} ({}) is an output of the board, but the design uses it as an input", p.pin, p.name)),
            Kind::Button { .. } | Kind::Clock | Kind::Uart { rx: true } if is_out => b.warnings.push(format!("pin {} ({}) drives the FPGA, but the design uses it as an output", p.pin, p.name)),
            _ => {}
        }
    }
    Ok(b)
}
