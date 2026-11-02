# EDA-Skills: 嘉立创EDA专业版声明式原理图引擎

面向 AI Coding Agent（Claude Code / Antigravity / Cursor / OpenCode）打造的**嘉立创EDA专业版（EasyEDA Pro）声明式布局与正交连线框架**。

> **AI Agent 提示词入口**：请直接阅读并遵循 [SKILL.md](./SKILL.md)。

## 核心目录结构

- [SKILL.md](./SKILL.md) — **AI Agent 专用系统提示词与工作流规范**（坐标系铁律、DSL Schema、引脚探测、视觉自检闭环）
- [src/bridge/lceda-bridge.js](./src/bridge/lceda-bridge.js) — 本地 CLI 桥接器（封装 `lceda-pro` 会话管理与脚本安全注入）
- [src/compiler/sch-compiler.js](./src/compiler/sch-compiler.js) — 声明式原理图编译器（主干轨、T型旁路分支、正交导线、去重标签、区域渲染）
- [src/layout/router.js](./src/layout/router.js) — 严格正交曼哈顿导线路由器
- [examples/test-declarative-circuit.js](./examples/test-declarative-circuit.js) — 端到端示例（AMS1117-3.3 稳压滤波电路自动绘制与渲染图导出）

## 快速运行测试

确保嘉立创EDA专业版桌面客户端（V4.1.70+）已打开任意工程，在终端执行：

```bash
node examples/test-declarative-circuit.js
```

执行完成后，除了在客户端画布实时生成原理图外，还会在 `test/output-schematic.png` 自动导出高清局部渲染图供 Agent 视觉自检。

