# Task 036 — 模型表静态检查与 per-CLI 枚举器

从 T-017 拆出的独立任务（原 AC-042 语义在这里）。T-017 只交付了配置驱动的 `models enumerate/add`；本任务交付"代码里不许硬编码模型清单"的静态检查，以及 per-CLI 枚举器骨架。

## 背景

- 已合并：`lib/commands/models/{enumerate,add}.mjs`（配置驱动）、`lib/catalog.mjs`、命令注册表（命令模块 `export const route` 即被 `lib/cli.mjs` 发现，**不要修改 cli.mjs**）。
- 模型/CLI 的权威描述应从配置与 `contracts/` 读取，而不是写在代码里。

## 交付物

1. `scripts/check-no-model-table.mjs`
   - 退出码 0 = 通过；非 0 = 发现硬编码清单
   - 扫描 `lib/**`（排除 `lib/commands/_util.mjs` 等白名单）与 `lib/commands/**`
   - 命中特征：一段字面量数组/对象里出现 **≥3 个**已知 CLI 名或模型 id 的硬编码组合（例如 `['claude','codex','gemini',...]`）
   - 命中时输出文件路径 + 行号 + 命中的字面量片段；不得静默通过
2. `test/unit/check-no-model-table.test.mjs`
   - 用夹具验证：干净文件通过、含 3 个硬编码 CLI 名的文件失败、白名单文件不误报
   - 测试名以 `[AC-079]` 开头
3. `test/flows/steps/enumerate.mjs`
   - flow 步骤：调用 `cliworker models enumerate` 并断言其输出可解析、字段齐全（最小的端到端接线）
4. `test/traceability/T-036.json`：`AC-079` → 上述测试文件，状态 covered，milestone M3

## 硬约束

- 不要修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs`。
- 不对既有测试放宽断言。
- 完成后 `node --test "test/unit/*.test.mjs"` 必须 0 fail（当前基线 356 pass）。

## 验收

- AC-079（contract）：`node scripts/check-no-model-table.mjs` 退出 0，并输出 `AC-079 OK`。
- 另加一条回归门禁：既有单元测试全绿。
