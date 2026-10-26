# Traditional (Taiwan) README -> Simplified Chinese with mainland EDA terms.
#   python3 tools/tocn.py veryl-eda/README.tw.md veryl-eda/README.cn.md
# Needs OpenCC: pip install opencc-python-reimplemented (tw2sp, Taiwan -> mainland
# phrases). EDA terms are replaced first and kept away from OpenCC (placeholders);
# code spans and URLs are left alone. Afterwards fix the language bar (line 2) and
# read the result: add missing terms to PRE rather than editing the output.
import sys, re
from opencc import OpenCC
PRE = [  # applied to the Traditional text first (longest first); targets already Simplified
 ('佈局繞線','布局布线'),('自己的佈局繞線','自研布局布线'),('全域繞線','全局布线'),('細部繞線','详细布线'),('重繞','重新布线'),('繞不通','布不通'),('繞得通','布得通'),('繞好','布好'),('繞成','布成'),('繞線','布线'),('佈局','布局'),
 ('暫存器檔','寄存器堆'),('正反器','触发器'),('暫存器','寄存器'),
 ('標準元件','标准单元'),('填充元件','填充单元'),('元件庫','单元库'),('元件','单元'),
 ('記憶體編譯器','存储器编译器'),('記憶體','存储器'),('晶片資料庫','芯片数据库'),('晶片','芯片'),('晶粒','裸片'),
 ('閘級','门级'),('通用閘','通用门'),('閘','门'),
 ('時脈樹','时钟树'),('時脈域','时钟域'),('時脈','时钟'),('位元流','比特流'),('位元','位'),
 ('模擬器','仿真器'),('模擬退火','模拟退火'),('模擬','仿真'),('預設','默认'),
 ('列的翻轉','行的翻转'),('列高','行高'),('每條列邊界','每条行边界'),('列式佈局','行式布局'),('所在列','所在行'),('各列','各行'),('整欄','整列'),
 ('欄位','字段'),('陣列','数组'),('巨集','宏'),('硬巨集','硬宏'),('腳位','引脚'),('接腳','引脚'),('IO 腳','IO 引脚'),('腳','引脚'),
 ('低態有效','低电平有效'),('高態有效','高电平有效'),('非同步','异步'),('正緣','上升沿'),('負緣','下降沿'),
 ('實作','实现'),('函式','函数'),('組合迴路','组合环路'),('遞迴','递归'),('原始碼','源代码'),('程式碼','代码'),('程式','程序'),('介面','接口'),
 ('網表','网表'),('映射','映射'),('解碼器','译码器'),('多工器','多路选择器'),('同步讀取','同步读取'),('支撐集','支撑集'),
 ('線上','在线'),('範例','示例'),('印出','打印'),('單核心','单核'),('序列埠','串口'),('除頻','分频'),('擴充板','扩展板'),('多數決','多数表决'),('有號','有符号'),('致能','使能'),('符號執行','符号执行'),('全域','全局'),('細部','详细'),('敘述','语句'),('平行','并行'),('偵測','检测'),('回饋','反馈'),('位元組','字节'),('推論','推断'),('序列','序列'),('階層','层次'),('優先權','优先级'),('走訪','遍历'),('多驅動者決議','多驱动解析'),('合成','综合'),('試繞','试布'),
]
PRE.sort(key=lambda x: -len(x[0]))
rx = re.compile('|'.join(re.escape(a) for a, _ in PRE))
m = dict(PRE)
cc = OpenCC('tw2sp')
src = open(sys.argv[1]).read()
# keep code spans and URLs untouched
parts = re.split(r'(`[^`]*`|https?://\S+)', src)
# replaced terms go through OpenCC as placeholders, so it cannot re-convert them (e.g. 程序 -> 进程)
def conv(p):
    keep = []
    def ph(g):
        keep.append(m[g.group(0)])
        return '%d' % (len(keep) - 1)
    t = cc.convert(rx.sub(ph, p))
    return re.sub('(\d+)', lambda g: keep[int(g.group(1))], t)
out = ''.join(p if i % 2 else conv(p) for i, p in enumerate(parts))
open(sys.argv[2], 'w').write(out)
