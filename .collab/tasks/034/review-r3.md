# Task 034 评审 r3（review）

- 评审对象 git sha：946a4caeb2442a365626736bdbe84eee9aea8355（读取 `C:\git\dsh-CLIWorker\.git\refs\heads\task\034` 得到；本角色不执行 git）
- 结论：**needs_revision**
- 通过数/总数：0/1（编排方 CI 为 1/1，但与代码事实矛盾，该项无法确认）

## 本轮相对 r2 的变化

dev-r3 提交（946a4ca）仍无任何生产代码或测试改动：

- `lib/secrets/inline.mjs`（mtime 18:56:42）、`test/unit/inline-secret.test.mjs`（18:56:53）未变；`inline.mjs:46` 仍返回未注册的 `E_INLINE_SECRET`，测试第 32–35 行固化该码。
- `ls test/integration` 无 `secret-backend-failure.test.mjs`；`test/traceability` 无 `T-034.json`。
- `lib/commands` 仅有 config/models/providers/usage，无 `auth`；`lib/cli.mjs` 对 auth/secret 无匹配。
- `E_SECRET_BACKEND` 在 lib 下只出现在 `lib/contract/registry.mjs:104`，无任何抛出它的代码。
- `impl.md` 自述“按 design.md 暂停、AC-033 尚未通过、未运行验收命令”；dev-r3 交班单末尾 dev 回复同样为“未修改文件”。

r2 的 F1–F6 全部未修复，零进展。

## 逐条核对

### AC-033 —— 未满足

CI（ci-results.json，20:09:53）：退出码 0、最后一行 `AC-033 OK`，但 TAP 只有 5 个用例，全部来自 `test/unit/inline-secret.test.mjs`（`# tests 5`）。`node --test` 对不存在的路径不报失败，因此 exit 0 是缺失集成测试造成的假绿；brief.md 要求集成测试“缺一不可”，design.md 要求覆盖 E_CONFIG_SECRET_INLINE、E_SECRET_BACKEND（三平台 ENOENT）、auth status 的 set/unset 状态。这些均无实现、无测试。CI 结果与 brief/design 明显矛盾，该项标为无法确认；impl.md 本身也承认未通过。

## Findings

1. **[P0]** 集成测试 `test/integration/secret-backend-failure.test.mjs` 缺失（brief.md 必须创建项），CI 假绿。
2. **[P0]** 凭据后端失败（E_SECRET_BACKEND）与凭据状态无任何生产实现，无 `lib/commands/auth`、无 auth 路由。
3. **[P1]** `inline.mjs` 使用未注册码 `E_INLINE_SECRET`（`inline.mjs:46`；注册表仅有 `E_CONFIG_SECRET_INLINE`，`registry.mjs:96`），且未接入 `loadConfig`；`config.mjs:83-94` 自带规则，两套规则不一致。
4. **[P1]** `test/traceability/T-034.json` 缺失（brief 要求，但不在 design write_scope，需调度器裁决）。
5. **[P1]** brief（要求实现并通过两个测试）与 design（暂停至 T-013 合并）冲突未消解；acceptance.md 也未补全。dev 连续 r2、r3 因此空转。调度器必须先二选一：(a) 确认 T-013 合并并让 design/acceptance 恢复；(b) 修订 design，允许在不依赖 T-013 后端的前提下实现 brief 要求。否则继续迭代 dev 不会改变结论。
6. **[P2]** 单元测试未经 `loadConfig` 生产入口，缺大小写不敏感、合法 SecretRef 用例。

## 结论

0/1，needs_revision。需调度器/人类先解决 brief 与 design 的冲突，再继续 dev。
