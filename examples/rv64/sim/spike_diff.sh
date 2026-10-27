#!/usr/bin/env bash
# 逐指令和 spike 比對：兩邊的「特權、pc、指令、寫入的暫存器與值」要一樣。
#   sim/spike_diff.sh PROG.elf [MAX]     印出第一個不同的地方；完全相同時結束碼 0
# spike 從開機 ROM（0x1000）開始，那幾個指令略過；mem / CSR 的欄位不比。
set -uo pipefail
cd "$(dirname "$0")/.."
[ -d /Users/Shared/ccc/oss-cad-suite/bin ] && export PATH=/Users/Shared/ccc/oss-cad-suite/bin:$PATH
ELF=$1; MAX=${2:-2000000}
T=$(mktemp -d)
spike -l --log-commits --isa=rv64imac_zicsr_zicntr_zifencei_sstc_svadu "$ELF" 2>&1 \
    | grep -E '^core +0: [0-3] 0x' | awk 'go || $4 ~ /^0x000000008/ { go = 1; print }' \
    | sed -E 's/^(core +0: [0-3] 0x[0-9a-f]+ \(0x[0-9a-f]+\))( x[0-9 ]+ 0x[0-9a-f]+)?.*/\1\2/' | head -n "$MAX" > "$T/spike"
./${OBJ:-sim/obj}/rv64sim -t -m 50000000 "$ELF" 2> /dev/null | grep -E '^core' | head -n "$MAX" > "$T/rtl"
n=$(wc -l < "$T/rtl"); m=$(wc -l < "$T/spike")
k=$(( n < m ? n : m ))
if cmp -s <(head -n "$k" "$T/spike") <(head -n "$k" "$T/rtl"); then
    echo "same: $k instructions (rtl $n, spike $m)"
    rm -rf "$T"; exit 0
fi
diff <(head -n "$k" "$T/spike") <(head -n "$k" "$T/rtl") | head -6
line=$(cmp <(head -n "$k" "$T/spike") <(head -n "$k" "$T/rtl") | awk '{print $NF}')
echo "first difference at instruction $line (spike <, rtl >)"
rm -rf "$T"; exit 1
