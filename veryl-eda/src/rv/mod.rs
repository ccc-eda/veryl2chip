//! Software for RvSoc (examples/src/rvsoc.veryl): a C compiler (`cc`), an
//! RV32I assembler (`asm`) and an instruction-set simulator (`iss`). A compiled
//! program goes into the SoC's block RAMs (`bram::program_lanes`), on the
//! virtual board or in a bitstream (`pnr::patch_ram`).

pub mod asm;
pub mod cc;
pub mod iss;
