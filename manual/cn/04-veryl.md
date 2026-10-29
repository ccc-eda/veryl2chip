# 4. 写给 veryl2chip 的 Veryl

veryl2chip 读的就是一般的 Veryl（用 `veryl-parser` 0.22 解析），文件不需要特别的格式。
官方 `veryl check` 是语法与语意的标准答案；veryl2chip 的仿真器刻意比较小，它说「不支持」的东西不一定是语法错误。

## 一个设计的文件

- 一次可以给好几个 `.veryl` 档：`v2c sim a.veryl b.veryl`，模块可以互相引用，顺序不拘。
- package、enum（成员写成 `Pkg::EnumName::Member`）、struct（第一个字段在最高位，和 SystemVerilog 一样）、
  const、function、interface 与 modport、generate for / if 都可以用。
- 有 `Veryl.toml` 的 Veryl 项目也能直接用：把 `src/*.veryl` 交给 `v2c` 即可。

## testbench

testbench 是一个带 `#[test(名稱)]` 的 module。标准写法：

```veryl
#[test(test_x)]
module TestX {
    inst clk: $tb::clock_gen;          // 這個 inst 本身就是時脈
    inst rst: $tb::reset_gen(clk);     // 記住它用的時脈

    // ... inst dut: X (i_clk: clk, i_rst: rst, ...);

    initial {
        rst.assert();                  // 拉 reset，經過一拍
        clk.next(10);                  // 前進 10 個時脈
        $assert(dut_output == 8'd42);  // 不成立就記一次失敗
        $finish();
    }
}
```

- 不要自己写 `var clk: clock` 再手动翻转；用 `$tb::clock_gen`。
- 每一个 `initial` 语句之后，仿真器都会让组合逻辑稳定下来，所以没有时钟的纯组合电路也可以这样测：
  设输入、下一行就 `$assert` 输出。
- 可用的系统函数：`$display $write $info $warning $error $fatal $assert $finish $time $clog2 $signed $unsigned $bits $random`。
- 想让 testbench 快一点，可以用参数把设计缩小（例如计数器的宽度），教学的 Blinky 就是这样做的。

## 支持的语法

| 仿真（`v2c sim`） | 综合（`v2c synth / fpga / asic`） |
|---|---|
| module、参数、const、port、`var`、`let`、`assign`、`always_comb`、`always_ff`（`if_reset`、同步 / 异步 reset、上升沿 / 下降沿）、`if`、`case`、`switch`、`for`、`inst`、`initial`、`final` | 同左（`initial` / `final` 与 `$display` 类会被忽略） |
| package、enum、struct、一维数组、function（不可递归）、generate、`import Pkg::*`、interface / modport | 同左；数组以变量索引读写会变成多路选择器 / 译码器 |
| 4 态值（0 / 1 / x），最多 256 bit | 常数最多 256 bit |
| | 操作符：`+ - *`、位 / 逻辑 / 化简、比较、移位（常数或变量）、串接、`repeat`、三元；`/ %` 综合成除法器；`**` 只限常数 |

**还不支持**：泛型 interface 端口（请指名 modport）、递归、`inout`、超过 256 bit 的宽度、latch
（没有完整赋值的 `always_comb` 在综合时会被当成组合环路回报）。

## 给综合看的写法

- **存储器**：数组如果只在**一个** `always_ff` 里以整个元素写入、也只以整个元素读取，就会被认成存储器。
  读出的数据再进寄存器（**同步读取**）的话，FPGA 上会变成 block RAM（`SB_RAM40_4K`），vlib ASIC 会变成 SRAM 宏；
  异步读取的存储器留在逻辑里。示例：`examples/src/sync_ram.veryl`。
- **初值**：优化器假设触发器上电为 0（iCE40 就是如此），从来不被写入的寄存器会被当成常数 0 移掉。
- **顶层**：综合默认取**最后一个非 testbench** 的 module；要综合别的就加 `--top`。

## Veryl 0.22 的陷阱（`veryl check` 验证过）

- `function` 本体里单独的 `<` / `>` 会让语法分析器以为是泛型：改用 `<=` / `>=` 或 `<:` / `>:`。
- enum 成员要写完整：`Pkg::EnumName::Member`，不是 `Pkg::Member`。
- `bit` 是保留字，不能当名称。
- 没有 reset 的数组写入，`veryl check` 会警告 `missing_reset_statement`；在那个 `always_ff` 前加 `#[allow(missing_reset_statement)]`。
- Veryl 0.22 内置的仿真器（`veryl test`）在 interface 设计上会算错；veryl2chip 与 iverilog 的结果一致。
