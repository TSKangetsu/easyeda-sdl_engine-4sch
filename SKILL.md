---
name: eda-declarative-schematic
description: 嘉立创EDA专业版（EasyEDA Pro）声明式原理图布局与正交连线引擎。当需要通过 AI Agent 自动绘制原理图、摆放元器件、连接电源轨与旁路滤波电容、串联电感/电阻、分压反馈网络、扇出折线（jog）、执行正交布线并导出渲染图自检时，必须使用此指南与编译器，严禁让大模型直接手算底层导线像素坐标。
---

# For AI: 嘉立创EDA专业版「声明式原理图」工作流指南 (Skill Guide)

你是一个驱动嘉立创EDA专业版（EasyEDA Pro Desktop Client）进行自动化硬件原理图设计的 AI Agent。
本工程提供了一套**符合前端直觉的高级声明式原理图编译引擎（`SchCompiler` + `SchRouter` + `LcedaBridge`）**，用于将高层的**声明式电路拓扑（JSON DSL）**自动编译为 100% 确定性的底层器件图元、正交导线（Manhattan Wires）、T型旁路分支、串联器件链、反馈分压网络与网络标签/端口。

---

## 一、 标准化 5 步研发闭环流程（原理图是单一真实源）

在任何电路研发与器件变更中，**原理图是全工程网络拓扑与器件定义的单一真实源（Single Source of Truth）**。严禁在 PCB 上直接进行飞线或修改封装！必须严格遵循以下 5 步研发闭环：

```text
[Step 1] 原理图器件与引脚探测 (Symbol & Pins Inspection)
    │
    ▼
[Step 2] 声明式原理图编译与生成 (Schematic DSL -> Canvas Generation)
    │
    ▼
[Step 3] 原理图到 PCB 的转换与同步 (eda.pcb_Document.importChanges)
    │
    ▼
[Step 4] 同步后真实物理焊盘探测与 DSL 更新 (Probe Synced Pads -> PCB DSL)
    │
    ▼
[Step 5] 声明式 PCB 编译、布线与闭环验证 (Compile -> Active DRC -> 2D/3D Visual Verification)
```

1. **Step 1: 原理图器件与引脚探测**：在修改电路或替换料号时，先查询符号的准确引脚编号与极性定义（例如公头与母头的针脚编号差异）。
2. **Step 2: 声明式原理图编译生成**：更新 `circuitSpec` DSL，由 `SchCompiler` 编译并在 EasyEDA 原理图画布上生成图元，通过 DRC 验证并审查渲染截图。
3. **Step 3: 原理图到 PCB 同步**：通过 `await eda.pcb_Document.importChanges(undefined, true)` 将器件更新与网表改动推送到 PCB。
4. **Step 4: PCB 焊盘探测与 DSL 适配**：在 PCB 端检查器件物理焊盘编号，调整 PCB DSL 中的大电流连线与打孔。
5. **Step 5: PCB 编译与双重自检**：执行 PCB 布局布线，确保 Active DRC = 0、飞线 = 0，并完成 2D/3D 视觉审查。

---

## 二、 原理图设计核心铁律（严禁违反）

1. **严禁手算像素连线**：
   * 不要直接裸写 `eda.sch_PrimitiveWire.create([[x1,y1,x2,y2]])` 去猜引脚坐标。必须使用本项目的 `SchCompiler.compileToJs(circuitSpec)`，由编译器根据器件真实引脚坐标自动正交布线。
2. **严格遵守笛卡尔坐标系（Y 轴向上为正）**：
   * 嘉立创原理图坐标系与前端 HTML DOM 相反：
     * **`+X` = 向右（Right）**，**`-X` = 向左（Left）**
     * **`+Y` = 向上（Up）**，**`-Y` = 向下（Down）**
   * 所有接地符号（`GND`）引出线、旁路滤波电容的下沉支线，必须向 **`-Y`（数值减小方向）** 延伸！绝不能写成 `+Y`，否则导线会倒插穿透芯片本体造成短路。
3. **密集引脚强制扇出（Fan-out with `jog`）**：
   * 当芯片引脚间距极小（如 QFN/SOP 封装引脚间距仅 10 mil）时，并排引线会发生元件与文字重叠。必须在 `rails` 中配置 `jog: { dx, dy }` 错开 Y 轴高度（如每路间隔 40~50 mil），再横向延伸器件。
   * **不同引脚扇出时必须使用不同的 `dx`**（或沿引脚上下错开），防止多条折线的垂直段重叠在同一条垂线上导致短路！
4. **单点网络命名与网络端口方向/极性（NetPort Polarity & Orientation）**：
   * 同一连通网络只需要**一个**网络名称来源（例如末端的 `Power` 符号、`Ground` 符号或 `NetPort` 端口）。
   * `SchCompiler` 内部在 `createPort` 中强制将 `valueVisible` 置为 `true`，确保所有网络端口文本清晰可见。
   * **端口固有极性与四向正交旋转规律（NetPort Polarity & 4-Direction Rules）**:
     * `OUT` 与 `BI` 端口：
       * 水平向右（`direction: 'right'`）：引脚在左，本体朝右（+X），标准 `rotation: 0`。
       * 水平向左（`direction: 'left'`）：引脚在右，本体朝左（-X），标准 `rotation: 180`。
       * 垂直向上（`direction: 'up'`）：引脚在下，本体朝上（+Y），标准 `rotation: 270`。
       * 垂直向下（`direction: 'down'`）：引脚在上，本体朝下（-Y），标准 `rotation: 90`。
     * `IN` 端口（其引脚位于箭头尖端，物理极性与 OUT/BI 正好相差 180°）：
       * 水平向左（`direction: 'left'`）：引脚在右（指向电路内部），本体与文本向左延伸，标准 `rotation: 0`。
       * 水平向右（`direction: 'right'`）：引脚在左（指向电路内部），本体与文本向右延伸，标准 `rotation: 180`。
       * 垂直向上（`direction: 'up'`）：引脚在下（指向电路内部），本体与文本向上延伸，标准 `rotation: 90`。
       * 垂直向下（`direction: 'down'`）：引脚在上（指向电路内部），本体与文本向下延伸，标准 `rotation: 270`。
     * `SchCompiler` 内部会自动根据 `direction` 与 `portType` 计算标准旋转角度；若传入反向角度，编译器会自动矫正，杜绝导线穿身（wire piercing）与文本重叠。
   * 内置 `hideRedundantWireLabels()` 机制，自动隐藏导线自带的冗余标签。
5. **器件库防挂起安全机制（Project Library Priority & Modal Auto-Dismiss）**：
   * 嘉立创 EDA 在重复放置工程库已存在的器件时，会弹出 `<div id="noticeCompVUpdatedDlg">` 对话框，阻塞 API Promise 导致 60s 超时。
   * `SchCompiler` 内置 50ms DOM 自动应答监听器，并在 `resolveDevice` 中优先检索当前工程库（`eda.lib_LibrariesList.getProjectLibraryUuid()`），在创建时传入 `addIntoLibrary: false`，杜绝弹窗挂起。
6. **强制视觉自检闭环（Render & Verify）**：
   * 每次生成或修改原理图后，**必须**检查返回的 `results.screenshotBase64` 导出的 PNG 图像，并用 `view_file` 亲自审查：**无斜线、无意外红点短路（Accidental Junctions）、无文字重叠、无悬空引脚**。

---

## 三、 抽象原理图组件化拓扑模型 (Mental Model)

在编写声明式 `circuitSpec` 时，按功能模块分块构建抽象电路：

```text
              VCC (Power Flag)
                 │
 (供电轨) ───────┴──────┬───────────┐ (jog 向上扇出，避开相邻引脚)
 direction:'right'      │           │
                      [C_DEC]     [Pin 7: VCC]
                       10uF         │
                        │       [ U_MAIN: 核心芯片/模块 ]
                        ▼           │
                      ╶─── GND    [Pin 6: OUT]
                                    │
 (输出轨) ──────────────┬───────────┘ (jog 向下扇出)
 direction:'right'      │
                      [L_FILTER] (串联器件 series)
                        │
                     (滤波轨) ──────┬──────────────┬──────── VOUT (Flag)
                                    │              │
                                  [C_OUT]        [R_TOP] (分压上臂)
                                   22uF            │
                                    │              ├──── [FB] Port (抽头端口)
                                    ▼              │
                                  ╶─── GND       [R_BOT] (分压下臂)
                                                   │
                                                   ▼
                                                 ╶─── GND
```

1. **核心芯片定位（`primaryComponents`）**：芯片位于模块基准原点 `origin: { x, y }`。
2. **多路走线扇出折线（`rails[].jog`）**：从引脚横向引出 `dx`，再纵向拐弯 `dy`，高度分层，避开相邻并排引线。
3. **主干电源轨与串联器件（`rails[].series`）**：沿走线方向串入二端器件（如串联滤波电感、电阻、隔直电容）。
4. **并联滤波旁路支路（`rails[].branches`）**：沿主干轨指定距离打 T 型节点，垂直挂接去耦电容并直达 `GND`。
5. **反馈分压网络（`rails[].divider`）**：自动生成分压上臂电阻 -> 中间抽头端口 -> 分压下臂电阻 -> `GND`。
6. **接地与端口（`groundPins` / `rail.port` / `rail.flag`）**：符号、标号与端口均由编译器自动对接和对齐。
7. **未连接引脚声明（`ncPins`）**：机械引脚或悬空引脚声明为 `ncPins`，自动添加打叉 NC 符号，防止 DRC 报未连接悬空引脚。

---

## 四、 抽象声明式 DSL Schema 规范 (`circuitSpec`)

```javascript
const circuitSpec = {
  name: 'Declarative_Schematic_Example',
  renderRegion: { minX: 100, minY: 100, maxX: 1200, maxY: 900 },
  renderWidth: 2000,
  modules: [
    {
      name: 'Power_Supply_Module',
      origin: { x: 400, y: 500 },

      // 1. 核心器件
      primaryComponents: [
        {
          id: 'U1',
          keyword: 'CHIP_PART_NUMBER', // 库检索关键词 (优先工程库)
          lcsc: 'C123456',              // 建议提供确切 LCSC 编号
          name: 'CHIP_NAME',
          offset: { x: 0, y: 0 },
          rotation: 0,
          labelOffsets: {
            designator: { dx: 15, dy: 5 },
            name: { dx: 15, dy: 0 }
          }
        }
      ],

      // 2. 引脚主干轨与扇出拓扑
      rails: [
        // 供电输入轨 (并联去耦电容)
        {
          name: 'VCC_INPUT_RAIL',
          from: { comp: 'U1', pin: '1' },
          direction: 'left',
          jog: { dx: -60, dy: 50 },
          length: 150,
          flag: { type: 'Power', net: 'VCC_3V3', rotation: 0 },
          branches: [
            {
              atDistance: 50,
              component: { id: 'C1', keyword: '0603_CAP', value: '10uF', rotation: 90 },
              branchLength: 40,
              groundStub: 25
            }
          ]
        },

        // 信号输出轨 (串联电阻后输出 NetPort)
        {
          name: 'SIG_OUT_RAIL',
          from: { comp: 'U1', pin: '2' },
          direction: 'right',
          length: 100,
          series: [
            { component: { id: 'R1', keyword: '0603_RES', value: '22Ω', rotation: 0 }, wireLength: 30 }
          ],
          port: { portType: 'OUT', net: 'TX_DATA', direction: 'right' }
        }
      ],

      // 3. 直连接地引脚
      groundPins: [
        { comp: 'U1', pin: 'GND_PIN', direction: 'down', stubLength: 25, rotation: 0 }
      ],

      // 4. 未连接引脚 (自动加 NC 符号)
      ncPins: [
        { comp: 'U1', pin: 'NC_PIN' }
      ]
    }
  ]
};
```

---

## 五、 编译与执行范式 (Code Execution)

```javascript
import { LcedaBridge } from '../src/bridge/lceda-bridge.js';
import { SchCompiler } from '../src/compiler/sch-compiler.js';
import fs from 'fs';

const bridge = new LcedaBridge();
const session = await bridge.getActiveSession();

// 1. 编译为可执行 JavaScript
const compiledJs = SchCompiler.compileToJs(circuitSpec);

// 2. 注入 EasyEDA 会话执行
const res = await bridge.invoke(session.sessionId, compiledJs);

if (!res.ok || !res.value?.ok) {
  console.error('原理图生成失败:', res.value?.error || res.error);
  process.exit(1);
}

const r = res.value.results;
console.log(`原理图生成成功! 器件数: ${Object.keys(r.components).length}, 导线条数: ${r.wires.length}`);

// 3. 闭环截图自检
if (r.screenshotBase64) {
  fs.writeFileSync('test/output-schematic.png', Buffer.from(r.screenshotBase64, 'base64'));
}
```

---

## 六、 视觉审查清单 (QA Checklist)

生成截图后，使用 `view_file` 检查导出的原理图图像：
1. **电源/接地旗标方向**：
   * 所有电源符号（`VCC`, `VIN`, `5V` 等）必须垂直向上（`rotation: 0`）。
   * 垂直下沉的 `GND` 必须朝下（`rotation: 0`）；水平延伸的 `GND` 必须向外朝向末端。
2. **走线间隙与文字防重叠**：
   * 同侧并排引脚必须通过 `jog` 错开 Y 轴高度。
   * 导线拐弯与器件之间必须留有充足净距，严禁文本重叠。
3. **零意外短路（Zero Accidental Junctions）**：
   * 导线十字交叉处绝不能出现意外连接红点。
