# Veryl 語法參考（grammar.md）

依據 `veryl-parser` 0.22 crate 內附的官方文法 `veryl.par`（parol 格式）整理，為本 repo
模擬器（`veryl-sim`）的 parser 前端所接受的語言。文末附 `veryl-sim` 目前支援／不支援的子集。

## 1. 詞彙結構

- 註解：`// 行註解`、`/* 區塊註解 */`
- 識別字：`[a-zA-Z_][0-9a-zA-Z_$]*`，可用 `r#name` 跳脫保留字
- 系統識別字：`$name`（如 `$display`、`$tb::clock_gen`）
- 數值字面值：
  - 位寬基底式：`<位寬>'<基底><數字>`，基底 `b`/`o`/`d`/`h`，可加 `s` 表有號
    例：`32'd0`、`8'hFF`、`5'b101`、`4'sd7`
  - 位寬less：`42`、`1_000`
  - 全位：`'0`、`'1`、`'x`
  - 實數：`1.5`、`1.5e-3`
- 字串：`"..."`；布林：`true` / `false`
- 屬性：`#[name]` 或 `#[name(arg, ...)]`，例如 `#[test(test_name)]`

## 2. 檔案結構

一個檔案由多個 description 組成，可加 `pub`：

```
[pub] module Name { ... }
[pub] interface Name [#[参数]] { ... }
[pub] package Name { ... }
[pub] function Name(...) -> Type { ... }
[pub] alias module NewName = OldName;
proto module/interface/package ...   // 原型宣告
embed (cargo) Name {{{ ... }}}       // 內嵌原生生碼
include (名稱, "路徑");
```

## 3. 型別

### 純量型別 ScalarType

```
{ tri | signed | default } ( 使用者自訂型別 [寬度] | 基本型別 )
```

- 基本變數型別 VariableType：`clock`、`clock_posedge`、`clock_negedge`、
  `reset`、`reset_async_high`、`reset_async_low`、`reset_sync_high`、
  `reset_sync_low`、`logic<寬度>`、`bit<寬度>`
- 固定型別 FixedType：`u8..u64`、`p8..p64`（有號 packed）、`i8..i64`、
  `f32`、`f64`、`bool`（`bbool`/`lbool`）、`string`
- 寬度：`logic<32>`、可多維 `logic<16, 8>`
- 陣列：型別後接 `[N]` 或 `[M, N]`，例：`logic<32> [16]`

### 使用者自訂型別

- `type Name = ArrayType;`（typedef）
- `enum Name: ScalarType { A, B = 3, C, }`
- `struct Name { field: ScalarType, ... }` / `union Name { ... }`
- struct/enum 可有泛型參數：`struct Name::<T: type> { ... }`

### 時鐘域

宣告與使用皆以 `'name` 標注：`var x: logic<8> 'a;`、`inst u: Mod 'a (...)`。

## 4. 運算式

### 運算子優先權（高→低）

| 層級 | 運算子 |
|---|---|
| 一元 | `!` `~` `~&` `~\|` `~^`、`+` `-` `&` `\|` `^`（縮減） |
| 乘冪 | `**` |
| 乘除 | `*` `/` `%` |
| 加減 | `+` `-` |
| 移位/比較 | `<<` `>>` `<<<` `>>>` `==` `!=` `==?` `!=?` `<` `<=` `>` `>=` `<:` `>:` |
| 位元 | `&` `^` `~^` `\|` |
| 邏輯 | `&&` `\|\|` |
| 三元 | `cond ? a : b`（可鏈結） |
| 轉型 | `as`（後置） |

- `<:` / `>:` 為有號/無號安全的比較（避免混合符號陷阱）。
- 選位：`x[msb:lsb]`、`x[i]`、`x[i+:w]`、`x[i-:w]`、`x[i step n]`；
  特殊：`$msb(x)`（最高有效位索引）、`$lsb(x)`；動態寬度可 `x[a+:$clog2(n)]`。

### 特殊運算式

- 串接：`{a, b, c}`，每項可加重複：`{val repeat 4}`（等同 SystemVerilog `{4{val}}`）
- 陣列字面值：`'{a, b, default: x}`
- case 運算式：`case x { A: v1, B | C: v2, default: v3 }`
- switch 運算式：`switch { cond1: v1, default: v3 }`
- `inside x { 1..5, 8, 10..=12 }` / `outside x { ... }`
  範圍運算子：`..`（不含尾）、`..=`（含尾）
- `type(expr)` 取得型別
- 函式呼叫：`f(a, b)`；帶標籤參數 `f(a: 1, b: 2)`

## 5. 宣告

```
var  name: ArrayType;                          // 宣告（未初始化）
let  name: ArrayType = expr;                   // 宣告並初始化（組合唯一驅動）
const NAME: type = expr;                        // 常數
gen   NAME: type = expr;                        // 編譯期常數（可用於 generate）
param NAME: type = expr;                        // 模組參數（#,  #(...)）
type  Name = ArrayType;                         // typedef
```

模組參數：`module M #( param W: u32 = 8, const D: logic<8> = '0 ) { ... }`
（`param` 必須由實例化覆寫；`const` 可有預設值）。

## 6. 敘述（Statement）

```
if      cond { ... } else if cond { ... } else { ... }
if_reset { ... } else { ... }                   // 僅限 always_ff 內，reset 時成立
case sel { 0: {...}, 1 | 2: {...}, default: {...} }   // 標籤可用範圍 1..=3
switch { cond1: {...}, default: {...} }
for i in 0..N { ... }                            // 可加 step: for i in 0..N step i += 2
for i in rev 0..N { ... }
return expr;    break;                           // function 內
```

賦值運算子：`=`、`+=` `-=` `*=` `/=` `%=`、`&=` `|=` `^=`、`<<=` `>>=` `<<<=` `>>>=`、
`<>`（connect，僅 interface 連接）。

## 7. 程序區塊

```
always_comb { ... }                              // 組合邏輯
always_ff (clk, rst) { if_reset {...} else {...} }      // 同步/非同步由 rst 型別決定
always_ff (clk_posedge clk, reset_async_low rst) { ... } // 可明確指定
initial { ... }                                  // 模擬起點（可模擬器用）
final { ... }                                    // 模擬結束
```

`always_ff` 內讀寫的訊號不得被其他程序驅動（Veryl 編譯器會檢查）。

## 8. 連續賦值與實例化

```
assign a = b & c;
assign {x, y} = w;                                // 串接賦值
connect iff.a <> iff_b;                           // interface 連接
inst u_name: ModuleName #( param W: 8 ) ( port1: sig1, port2: sig2, );
bind ModuleName: inst_name <> ModuleName2 (...);   // bind
```

實例化陣列：`inst u [4]: Module (...)`；連接可用 hierarchy：`u0.sub.sig`。

## 9. Function

```
function FuncName(
    a: input  logic<32>,
    b: output logic<32>,
) -> logic<32> {
    // 內部可宣告 var/let，最後 return
    return a;
}
```

呼叫端可接 output：`FuncName(x, y: out_var);`（以 `label: 變數` 接 output）。

## 10. Generate

```
if cond : label { ... } else : label2 { ... }
for i in 0..N : label { inst u [i]: ...; }
```

## 11. Package / Interface

```
package P {
    const C: logic<8> = 8'd1;
    enum E: logic<2> { A, B }
    function F(...) -> ... { ... }
}
// 使用：P::C、P::E::A；或 import P::*;
// import P::{C, E};  import P::*;

interface I #(param W: u32 = 8) {
    var req: logic;
    modport mp { req: input , ack: output }
    function f(...) -> ... { ... }
}
inst b: I;
always_comb { b.req = 1; }
connect b.mp <> a_mp;
```

## 12. veryl-sim 支援子集（本模擬器）

支援：module / param / const / port（input/output）/ var / let / assign /
always_comb / always_ff（if_reset、同步與非同步 reset、posedge/negedge）/
if / case / switch / for / inst（含參數覆寫、階層）/ initial（`clk.next(n)`、
`rst.assert(clk)`）/ `$tb::clock_gen`、`$tb::reset_gen` /
`$display $write $info $warning $error $fatal $assert $finish $time $clog2
$signed $unsigned $bits $random`。

**不支援**：interface/modport、package、struct/enum、陣列、使用者 function、
generate、case/switch 運算式、`inout`、寬度 > 128 bit。

## 13. 與 SystemVerilog 對照速查

| Veryl | SystemVerilog |
|---|---|
| `let x: logic<8> = y;` | `logic [7:0] x = y;`（單一驅動） |
| `var x: logic<8> [4];` | `logic [7:0] x [0:3];` |
| `{a repeat 4}` | `{4{a}}` |
| `if_reset { ... }` | `if (rst) begin ... end`（always_ff 內） |
| `x <: y` | `$signed` 感知比較 |
| `#[test(name)]` | （模擬器專屬，標記 testbench module） |
