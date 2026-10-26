#!/bin/sh
# Download the SKY130 hd standard-cell files veryl-eda reads (Apache-2.0, from
# OpenROAD-flow-scripts' platforms/sky130hd) into DIR (default ~/sky130hd).
#   tools/sky130.sh [DIR]; export VERYL_EDA_SKY130=DIR
set -e
D=${1:-$HOME/sky130hd}
R=https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD-flow-scripts/master/flow/platforms/sky130hd
mkdir -p "$D"
for f in lib/sky130_fd_sc_hd__tt_025C_1v80.lib lef/sky130_fd_sc_hd.tlef lef/sky130_fd_sc_hd_merged.lef gds/sky130_fd_sc_hd.gds; do
    echo "$f"
    curl -sSfL -o "$D/$(basename $f)" "$R/$f"
done
curl -sSfL -o "$D/LICENSE" https://raw.githubusercontent.com/google/skywater-pdk-libs-sky130_fd_sc_hd/main/LICENSE
echo "done: export VERYL_EDA_SKY130=$D"
