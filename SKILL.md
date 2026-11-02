---
name: eda-declarative-schematic
description: 嘉立创EDA专业版（EasyEDA Pro）声明式原理图布局与正交连线引擎。当需要通过 AI Agent 自动绘制原理图、摆放元器件、连接电源轨与旁路滤波电容、串联电感/电阻、分压反馈网络、扇出折线（jog）、执行正交布线并导出渲染图自检时，必须使用此指南与编译器，严禁让大模型直接手算底层导线像素坐标。
---

# For AI: 嘉立创EDA专业版「声明式原理图」工作流指南 (Skill Guide)

你是一个驱动嘉立创EDA专业版（EasyEDA Pro Desktop Client）进行自动化硬件原理图设计的 AI Agent。
本工程提供了一套**符合前端直觉的高级声明式原理图编译引擎（`SchCompiler` + `SchRouter` + `LcedaBridge`）**，用于将高层的**声明式电路拓扑（JSON DSL）**自动编译为 100% 确定性的底层器件图元、正交导线（Manhattan Wires）、T型旁路分支、串联器件链、反馈分压网络与网络标签/端口。

---

## 一、 核心铁律（严禁违反）

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
   * EasyEDA 原生创建 `OUT` 与 `BI` 类型 NetPort 时默认将 `Name` 属性的 `valueVisible` 设为 `false`，导致图纸上端口名隐形。`SchCompiler` 内部在 `createPort` 中强制将 `valueVisible` 置为 `true`，确保所有网络端口文本清晰可见。
   * **端口固有极性与四向正交旋转规律（NetPort Polarity & 4-Direction Rules）**:
     * OUT 与 BI 端口：
       * 水平向右（direction: 'right'）：引脚在左，本体朝右（+X），标准 otation: 0。
       * 水平向左（direction: 'left'）：引脚在右，本体朝左（-X），标准 otation: 180。
       * 垂直向上（direction: 'up'）：引脚在下，本体朝上（+Y），标准 otation: 270。
       * 垂直向下（direction: 'down'）：引脚在上，本体朝下（-Y），标准 otation: 90。
     * IN 端口（其引脚位于箭头尖端，物理极性与 OUT/BI 正好相差 180°）：
       * 水平向左（direction: 'left'）：引脚在右（指向电路内部），本体与文本向左延伸，标准 otation: 0。
       * 水平向右（direction: 'right'）：引脚在左（指向电路内部），本体与文本向右延伸，标准 otation: 180。
       * 垂直向上（direction: 'up'）：引脚在下（指向电路内部），本体与文本向上延伸，标准 otation: 90。
       * 垂直向下（direction: 'down'）：引脚在上（指向电路内部），本体与文本向下延伸，标准 otation: 270。
     * SchCompiler 内部会自动根据 direction 与 portType 计算标准旋转角度；若用户显式传入了 180° 反向的角度（如向左的 IN 端口误传了 otation: 180，或向上的 OUT 端口误传了 otation: 90），编译器会自动矫正，彻底杜绝导线穿身（wire piercing）与文本重叠。
   * 同时内置针对新生成导线的 `hideRedundantWireLabels()` 机制，自动隐藏导线图元自带的多余 `Name` 属性，消除图纸杂乱。
5. **器件库防挂起安全机制（Project Library Priority & Modal Auto-Dismiss）**：
   * 嘉立创EDA在重复放置工程库已存在的器件时，会弹出 `<div id="noticeCompVUpdatedDlg">` 模态对话框（“工程库存在其他版本，请选择你需要进行的操作”），阻塞 API Promise 导致 60s 报错超时。
   * `SchCompiler` 内置了 50ms DOM 自动应答监听器，并在 `resolveDevice` 中优先检索当前工程库（`eda.lib_LibrariesList.getProjectLibraryUuid()`），同时在创建时传入 `addIntoLibrary: false`，彻底根除弹窗挂起问题。
6. **强制视觉自检闭环（Render & Verify）**：
   * 每次生成或修改原理图后，**必须**检查返回的 `results.screenshotBase64` 导出的 PNG 图像（如 `test/output-schematic.png` 或 `test/mp9943-generated-schematic.png`），并用 `view_file` 亲自审查：**无斜线、无意外红点短路（Accidental Junctions）、无文字重叠、无悬空引脚**后，才算任务完成。

---

## 二、 前端组件化布局模型（Layout Mental Model）

在编写声明式 `circuitSpec` 时，请用前端组件化的层次化结构组织电路：

```text
               VIN (Power Flag)
                  │
   (VIN 轨) ──────┴──────┬───────────┐ (jog 向右140向上105扇出，避开PG)
   direction:'right'     │           │
                       [CV4]       [Pin 7: IN]
                       22uF          │
                         │       [ U8: MP9943 ]
                         ▼           │
                       ╶─── GND    [Pin 6: SW]
                                     │
   (SW 轨) ──────────────┬───────────┘ (jog 向右60向下95扇出)
   direction:'right'     │
                       [LV1] 10uH (串联电感 series)
                         │
                      (5V 轨) ──────┬──────────────┬──────────────┬──────── 5V (Flag)
                                    │              │              │
                                  [CV5]          [CV6]          [V2] 43k (分压上臂)
                                  22uF           22uF             │
                                    │              │              ├──── [FB_TAP] Port
                                    ▼              ▼              │
                                  ╶─── GND       ╶─── GND       [V3] 7.5k (分压下臂)
                                                                  │
                                                                  ▼
                                                                ╶─── GND
```

1. **核心芯片定位（`primaryComponents`）**：
   * 芯片位于模块基准原点 `origin: { x, y }`。
2. **多路走线扇出折线（`rails[].jog`）**：
   * 从引脚先横向伸出 `dx`，再纵向拐弯 `dy`，避开周围紧挨的引脚。
   * **严密计算高度分层**：同侧引脚向下扇出时，越靠下的引脚向下折落的高度必须越深，且垂直下折点必须靠内（靠近芯片），外侧上部引线在其上方水平通过，从而实现完全平面无交叉走线（Zero-Crossing Planar Routing）。
3. **主干电源轨与串联器件（`rails[].series`）**：
   * 沿走线方向串入二端器件（如功率电感 `LV1`、自举电阻 `V6`、自举电容 `CV2`），并可在器件前后插入网络端口（如 `tapBefore: { port: { net: 'SW' } }`）。
4. **并联滤波旁路支路（`rails[].branches`）**：
   * 沿电源轨指定距离（`atDistance`）向下打 T 型节点，垂直挂接电容并直达 `GND`。
5. **反馈分压网络（`rails[].divider`）**：
   * 自动生成上拉电阻 -> 中间抽头输出 `NetPort` -> 下拉电阻 -> `GND` 的经典分压拓扑。
6. **接地与端口（`groundPins` / `rail.port` / `rail.flag`）**：
   * 芯片与支路的接地符号、网络标号与端口均由编译器自动对接和对齐。

---

## 三、 声明式 DSL Schema 完整规范 (`circuitSpec`)

```javascript
const circuitSpec = {
  name: 'MP9943_Buck_Converter',
  renderRegion: { minX: 2550, minY: 1200, maxX: 3600, maxY: 1800 },
  renderWidth: 1600,
  modules: [
    {
      name: 'MP9943_Power_Stage',
      origin: { x: 3000, y: 1600 },

      // 1. 核心芯片器件
      primaryComponents: [
        {
          id: 'U8',
          keyword: 'MP9943GQ-Z',   // 库搜索关键词（优先匹配工程库）
          name: 'MP9943GQ-Z',      // 参数值
          offset: { x: 0, y: 0 },
          rotation: 0
        }
      ],

      // 2. 引脚主干轨与扇出拓扑
      rails: [
        // Pin 7 (IN) -> 向右140越过PG端口后向上105 -> VIN 轨 (并联滤波 CV4 22uF, CV3 100nF)
        {
          name: 'VIN_INPUT_RAIL',
          from: { comp: 'U8', pin: '7' },
          direction: 'right',
          jog: { dx: 140, dy: 105 },
          length: 220,
          flag: { type: 'Power', net: 'VIN', rotation: 0 },
          branches: [
            {
              atDistance: 60,
              component: { id: 'CV4', keyword: 'CL10A', value: '22uF', rotation: 90 },
              branchLength: 50,
              groundStub: 25
            },
            {
              atDistance: 140,
              component: { id: 'CV3', keyword: 'CL10A', value: '100nF', rotation: 90 },
              branchLength: 50,
              groundStub: 25
            }
          ]
        },

        // Pin 8 (PG) -> NetPort 'PG'
        {
          name: 'PG_RAIL',
          from: { comp: 'U8', pin: '8' },
          direction: 'right',
          length: 50,
          port: { portType: 'OUT', net: 'PG', rotation: 0 }
        },

        // Pin 6 (SW) -> 向右60向下95 -> SW 端口 -> 串联电感 LV1 -> 5V 输出轨 + CV5, CV6 + 反馈分压器
        {
          name: 'VOUT_5V_RAIL',
          from: { comp: 'U8', pin: '6' },
          direction: 'right',
          jog: { dx: 60, dy: -95 },
          series: [
            {
              component: { id: 'LV1', keyword: 'TMPA0402SP-100MN', value: '10uH', rotation: 0 },
              wireLength: 35,
              tapBefore: {
                port: { portType: 'BI', net: 'SW', direction: 'left', stubLength: 40, rotation: 180 }
              }
            }
          ],
          length: 290,
          flag: { type: 'Power', net: '5V', rotation: 0 },
          branches: [
            {
              atDistance: 60,
              component: { id: 'CV5', keyword: 'CL10A', value: '22uF', rotation: 90 },
              branchLength: 50,
              groundStub: 25
            },
            {
              atDistance: 135,
              component: { id: 'CV6', keyword: 'CL10A', value: '22uF', rotation: 90 },
              branchLength: 50,
              groundStub: 25
            }
          ],
          divider: {
            atDistance: 215,
            topResistor: { id: 'V2', keyword: 'RT0603', value: '43kΩ', rotation: 90 },
            bottomResistor: { id: 'V3', keyword: 'RT0603', value: '7.5kΩ', rotation: 90 },
            branchLength: 45,
            dividerSpacing: 45,
            groundStub: 25,
            tapPort: { portType: 'OUT', net: 'FB_TAP', direction: 'right', stubLength: 35, rotation: 0 }
          }
        },

        // Pin 4 (BST) -> 向下深扇出至 y=1460 -> 串联电阻 V6 (20Ω) -> 串联电容 CV2 (100nF) -> NetPort 'SW'
        {
          name: 'BST_RAIL',
          from: { comp: 'U8', pin: '4' },
          direction: 'left',
          jog: { dx: -20, dy: -125 },
          series: [
            { component: { id: 'V6', keyword: 'RT0603', value: '20Ω', rotation: 0 }, wireLength: 30 },
            { component: { id: 'CV2', keyword: 'CL10A', value: '100nF', rotation: 0 }, wireLength: 30 }
          ],
          port: { portType: 'BI', net: 'SW', direction: 'left', stubLength: 60, rotation: 180 }
        },

        // Pin 3 (EN/SYNC) -> 向下扇出至 y=1520 (在BST上方) -> 串联电阻 V5 (1MΩ) -> Power Flag 'VIN'
        {
          name: 'EN_RAIL',
          from: { comp: 'U8', pin: '3' },
          direction: 'left',
          jog: { dx: -45, dy: -75 },
          series: [
            { component: { id: 'V5', keyword: 'RT0603', value: '1MΩ', rotation: 0 }, wireLength: 30 }
          ],
          flag: { type: 'Power', net: 'VIN', direction: 'left', stubLength: 30, rotation: 0 }
        },

        // Pin 2 (VCC) -> 水平向左串联滤波电容 CV1 (10uF) 直通向下接地符号
        {
          name: 'VCC_RAIL',
          from: { comp: 'U8', pin: '2' },
          direction: 'left',
          series: [
            { component: { id: 'CV1', keyword: 'CL10A', value: '10uF', rotation: 0 }, wireLength: 30 }
          ],
          length: 40,
          flag: { type: 'Ground', net: 'GND', direction: 'down', stubLength: 25, rotation: 0 }
        },

        // Pin 1 (FB) -> 向上扇出至 y=1690 -> 串联电阻 V1 (51kΩ) -> NetPort 'FB_TAP'
        {
          name: 'FB_RAIL',
          from: { comp: 'U8', pin: '1' },
          direction: 'left',
          jog: { dx: -40, dy: 75 },
          series: [
            { component: { id: 'V1', keyword: 'RT0603', value: '51kΩ', rotation: 0 }, wireLength: 30 }
          ],
          port: { portType: 'IN', net: 'FB_TAP', direction: 'left', stubLength: 90, rotation: 0 }
        }
      ],

      // 3. 芯片直连接地引脚
      groundPins: [
        { comp: 'U8', pin: '5', direction: 'right', stubLength: 30, rotation: 270 }
      ]
    }
  ]
};
```

---

## 四、 编译与执行范式 (Code Execution)

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

if (res.ok && res.value?.ok) {
  const r = res.value.results;
  console.log(`生成成功! 器件数: ${Object.keys(r.components).length}, 导线条数: ${r.wires.length}`);
  
  // 3. 保存高清截图
  if (r.screenshotBase64) {
    fs.writeFileSync('test/mp9943-generated-schematic.png', Buffer.from(r.screenshotBase64, 'base64'));
  }
}
```

---

## 五、 视觉自检清单 (QA Checklist)

生成截图后，使用多模态工具（`view_file`）检查图像并逐项核对：
1. **电源/接地旗标方向**：
   * 所有 `VIN`、`5V`、`3V3` 等电源符号必须朝上（`rotation: 0`）。
   * 垂直下沉的 `GND` 必须朝下（`rotation: 0`）；水平延伸的 `GND` 必须向左或向右朝向末端。
2. **走线与引脚间隙**：
   * 芯片同一侧的并排引脚，引线是否通过 `jog` 错开高度？
   * 各支路器件（电容、电阻、端口）之间是否有至少 30 mil 的空间，杜绝文字重叠。
   * 网络端口（`NetPort`）引出线长度是否充足（至少 60~80 mil），避免端口文本直接覆盖相连二端器件。
3. **闭环连通性**：
   * 自举电容 `BST` 端的 `NetPort SW` 与电感前端的 `NetPort SW` 网络名必须严格一致。
   * 分压网络抽头 `FB_TAP` 与芯片反馈引脚 `FB` 端的 `NetPort FB_TAP` 必须严格一致。
4. **零意外短路（Zero Accidental Junctions）**：
   * 审查导线拐角与水平主干之间绝不能出现由于线距不足或折弯交叠产生的意外红点连接（Red Junction Dots）。
