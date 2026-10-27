// Simulation model of the ECP5 DP16KD block RAM in the shape veryl-eda uses it
// (ecp5::brams): DATA_WIDTH_A = DATA_WIDTH_B = 9 (2048 words, address on AD*13..3),
// port A writes (WEA & CEA), port B reads (CEB, NOREG: DOB is the registered read of
// the old word), chip selects tied to CSDECODE. yosys' cells_sim.v only declares the
// cell; simulations use cells_sim.v without its DP16KD and this file.
module DP16KD(
  input DIA17, DIA16, DIA15, DIA14, DIA13, DIA12, DIA11, DIA10, DIA9, DIA8, DIA7, DIA6, DIA5, DIA4, DIA3, DIA2, DIA1, DIA0,
  input ADA13, ADA12, ADA11, ADA10, ADA9, ADA8, ADA7, ADA6, ADA5, ADA4, ADA3, ADA2, ADA1, ADA0,
  input CEA, OCEA, CLKA, WEA, RSTA,
  input CSA2, CSA1, CSA0,
  output DOA17, DOA16, DOA15, DOA14, DOA13, DOA12, DOA11, DOA10, DOA9, DOA8, DOA7, DOA6, DOA5, DOA4, DOA3, DOA2, DOA1, DOA0,
  input DIB17, DIB16, DIB15, DIB14, DIB13, DIB12, DIB11, DIB10, DIB9, DIB8, DIB7, DIB6, DIB5, DIB4, DIB3, DIB2, DIB1, DIB0,
  input ADB13, ADB12, ADB11, ADB10, ADB9, ADB8, ADB7, ADB6, ADB5, ADB4, ADB3, ADB2, ADB1, ADB0,
  input CEB, OCEB, CLKB, WEB, RSTB,
  input CSB2, CSB1, CSB0,
  output DOB17, DOB16, DOB15, DOB14, DOB13, DOB12, DOB11, DOB10, DOB9, DOB8, DOB7, DOB6, DOB5, DOB4, DOB3, DOB2, DOB1, DOB0
);
  parameter DATA_WIDTH_A = 9;
  parameter DATA_WIDTH_B = 9;
  parameter REGMODE_A = "NOREG";
  parameter REGMODE_B = "NOREG";
  parameter RESETMODE = "SYNC";
  parameter ASYNC_RESET_RELEASE = "SYNC";
  parameter CSDECODE_A = "0b000";
  parameter CSDECODE_B = "0b000";
  parameter WRITEMODE_A = "NORMAL";
  parameter WRITEMODE_B = "NORMAL";
  parameter GSR = "ENABLED";
  parameter WID = 0;
  parameter INIT_DATA = "STATIC";

  reg [8:0] mem [0:2047];
  reg [8:0] q;
  integer i;
  initial begin
    for (i = 0; i < 2048; i = i + 1) mem[i] = 9'd0;
    q = 9'd0;
  end
  wire [10:0] wa = {ADA13, ADA12, ADA11, ADA10, ADA9, ADA8, ADA7, ADA6, ADA5, ADA4, ADA3};
  wire [10:0] ra = {ADB13, ADB12, ADB11, ADB10, ADB9, ADB8, ADB7, ADB6, ADB5, ADB4, ADB3};
  wire [8:0] wd = {DIA8, DIA7, DIA6, DIA5, DIA4, DIA3, DIA2, DIA1, DIA0};
  always @(posedge CLKA) if (CEA && WEA) mem[wa] <= wd;
  always @(posedge CLKB) if (CEB) q <= mem[ra];
  assign {DOB8, DOB7, DOB6, DOB5, DOB4, DOB3, DOB2, DOB1, DOB0} = q;
  assign {DOB17, DOB16, DOB15, DOB14, DOB13, DOB12, DOB11, DOB10, DOB9} = 9'd0;
  assign {DOA17, DOA16, DOA15, DOA14, DOA13, DOA12, DOA11, DOA10, DOA9, DOA8, DOA7, DOA6, DOA5, DOA4, DOA3, DOA2, DOA1, DOA0} = 18'd0;
endmodule
