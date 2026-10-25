// Post-place-and-route simulation: `chip` is the routed bitstream turned
// back into Verilog by `icebox_vlog`. Hold reset, run the clock and wait
// for the program to put fib(10) = 55 on the LEDs.
`timescale 1ns/1ps
module tb;
    reg clk = 0, rst = 0;
    wire [7:0] led;
    chip dut (
        .i_clk(clk), .i_rst(rst),
        .\o_led[0] (led[0]), .\o_led[1] (led[1]), .\o_led[2] (led[2]), .\o_led[3] (led[3]),
        .\o_led[4] (led[4]), .\o_led[5] (led[5]), .\o_led[6] (led[6]), .\o_led[7] (led[7])
    );
    always #41.667 clk = ~clk; // 12 MHz
    integer cycle = 0;
    always @(posedge clk) cycle <= cycle + 1;
    initial begin
        repeat (3) @(posedge clk);
        rst = 1;
        while (led !== 8'd55 && cycle < 500) @(posedge clk);
        if (led === 8'd55) $display("PASS: LED = %0d after %0d cycles", led, cycle);
        else $display("FAIL: LED = %b after %0d cycles", led, cycle);
        $finish;
    end
endmodule
