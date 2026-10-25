// Gate-level simulation of the iCE40-mapped SoC (SB_LUT4/SB_CARRY/SB_DFF*,
// with yosys' iCE40 cell models): wait for fib(10) = 55 on the LEDs.
`timescale 1ns/1ps
module tb;
    reg clk = 0, rst = 0;
    wire [7:0] led;
    RiscvSoc dut (.i_clk(clk), .i_rst(rst), .o_led(led));
    always #41.667 clk = ~clk;
    integer cycle = 0;
    always @(posedge clk) cycle <= cycle + 1;
    initial begin
        repeat (3) @(posedge clk);
        rst = 1;
        while (led !== 8'd55 && cycle < 500) @(posedge clk);
        $display("%s: LED = %0d after %0d cycles", led === 8'd55 ? "PASS" : "FAIL", led, cycle);
        $finish;
    end
endmodule
