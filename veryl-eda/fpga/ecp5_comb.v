// TRELLIS_COMB (the packed LUT / carry half nextpnr-ecp5 writes) for the post-route
// equivalence check: yosys' model (techlibs/ecp5/common_sim.vh) declares `wire FCO = ...`
// inside its CCU2 generate block, a new wire that leaves the FCO output undriven.
// Read with `read_verilog -overwrite` after cells_sim.v. Logic and CCU2 modes only.
module TRELLIS_COMB(
	input A, B, C, D, M,
	input FCI, F1, FXA, FXB,
	input WD,
	input WAD0, WAD1, WAD2, WAD3,
	input WRE, WCK,
	output F, FCO, OFX
);
	parameter MODE = "LOGIC";
	parameter INITVAL = 16'h0;
	parameter CCU2_INJECT1 = "NO";
	parameter WREMUX = "WRE";
	parameter IS_Z1 = 1'b0;

	generate
		if (MODE == "LOGIC") begin: mode_logic
			LUT4 #(.INIT(INITVAL)) lut4 (.A(A), .B(B), .C(C), .D(D), .Z(F));
			assign FCO = 1'b0;
		end else begin: mode_ccu2
			wire l4o, l2o;
			LUT4 #(.INIT(INITVAL)) lut4_0(.A(A), .B(B), .C(C), .D(D), .Z(l4o));
			LUT2 #(.INIT(INITVAL[3:0])) lut2_0(.A(A), .B(B), .Z(l2o));
			wire gated_cin_0 = (CCU2_INJECT1 == "YES") ? 1'b0 : FCI;
			assign F = l4o ^ gated_cin_0;
			wire gated_lut2_0 = (CCU2_INJECT1 == "YES") ? 1'b0 : l2o;
			assign FCO = (~l4o & gated_lut2_0) | (l4o & FCI);
		end
		if (IS_Z1)
			L6MUX21 lutx_mux (.D0(FXA), .D1(FXB), .SD(M), .Z(OFX));
		else
			PFUMX lut5_mux (.ALUT(F1), .BLUT(F), .C0(M), .Z(OFX));
	endgenerate
endmodule
