# 8. 综合后仿真：`v2c gatesim`

```
v2c gatesim opt|ice40|ecp5|asic|sky130 [--top MODULE] FILE.veryl...
```

综合器会不会把电路做错？最直接的检查：**用同一个 testbench**，把被测的 module 换成它综合后的网表，再仿真一次。

```sh
$ v2c gatesim ice40 counter.veryl
=== simulating TestCounter ===
TestCounter: PASS
gate-level simulation: Counter as 10 cells (ice40)
```

| 网表 | 内容 |
|---|---|
| `opt` | 优化后的通用门（`v2c synth` 的结果） |
| `ice40` | iCE40 对应后：`SB_LUT4`、`SB_CARRY`、`SB_DFF*`、`SB_RAM40_4K` |
| `ecp5` | ECP5 对应后：`LUT4`、`CCU2C`、`TRELLIS_FF` |
| `asic` | vlib 标准单元（含 SRAM 宏） |
| `sky130` | SkyWater SKY130 标准单元 |

- 被换掉的是 `--top`（默认：最后一个不是 testbench 的 module）；文件里所有 testbench 照常运行。
- testbench 若用不同参数实例化设计，每组参数各综合一份网表。
- 门级模型保留 x 的传递（LUT 用多路选择器树表示），所以未初始化的值会像 RTL 一样是 x。
- 结果和 `v2c sim` 不同，表示综合有问题（或设计依赖了综合器假设不成立的东西，例如未初始化的寄存器——优化器假设上电为 0）。

网页 IDE 的「仿真对象」菜单（RTL / 门级：通用门 / iCE40 / 标准单元）做的是同一件事；✔ 全面验证一次跑完 RTL 与三种网表并比较。
