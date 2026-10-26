# SKY130 hd cells used by veryl-eda

A subset of SkyWater's `sky130_fd_sc_hd` standard-cell library (typical corner `tt_025C_1v80`):
the cells veryl-eda's ASIC flow binds to (`src/pdk/mod.rs`, `SKY130_HD`), buffers in several sizes,
fillers, the well tap and decaps.

- `sky130_fd_sc_hd__tt_025C_1v80.lib`: Liberty, the library header and those cells, without the power tables
- `sky130_fd_sc_hd.tlef`: the technology LEF, unchanged
- `sky130_fd_sc_hd.lef`: those cells' MACROs from `sky130_fd_sc_hd_merged.lef`
- `sky130_fd_sc_hd.gds`: those cells' GDS structures

Made by `tools/sky130_subset.py` from the files `tools/sky130.sh` downloads
(OpenROAD-flow-scripts, `flow/platforms/sky130hd`).

Copyright 2020 The SkyWater PDK Authors. Licensed under the Apache License, Version 2.0 (`LICENSE`);
this subset is a modified version (cells and tables removed). veryl-eda itself is MIT licensed.
