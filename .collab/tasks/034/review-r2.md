# Task 034 评审 r2（review）

- 评审对象 git sha：83eb578d6f278c571267985f6e9cf1754c11d52b（读取 `.git/refs/heads/task/034` 得到；本角色不执行 git）
- 结论：**needs_revision**
- 通过数/总数：0/1（编排方 CI 为 1/1，但与代码事实矛盾，该项无法确认）

## 本轮相对 r1 的变化

dev-r2 提交（83eb578）没有改变任何生产代码或测试：

- `lib/secrets/inline.mjs`、`test/unit/inline-secret.test.mjs` 的 mtime 仍为 18:56，内容与 r1 评审时一致，仍使用未注册的 `E_INLINE_SECRET`。
- dev-r2 日志末尾：dev 只创建了 `impl.md`，称“记录任务暂停状态…未修改生产代码或测试文件，也未运行验收命令；AC-033 尚未通过”。
- `impl.md` 自述同样如此。
- `ls test/integration | grep -i secret`、`ls test/traceability | grep 034` 均无结果；`lib/commands` 下无 `auth`；`lib/cli.mjs` 无 auth/secrets 路由。

r1 的 F1–F4 全部未修复。

## 逐条核对

### AC-033 配置明文拒载与凭据后端失败处理 —— 未满足

CI 证据（ci-results.json，2026-11-08T20:06:49+08:00）：退出码 0，最后一行 `AC-033 OK`，`# tests 5 / pass 5`。
独立核对：这 5 个用例的名称与 `test/unit/inline-secret.test.mjs` 第 5、11、23、32、40 行一一对应，TAP 中没有任何集成用例。`node --test` 对不存在的路径不报失败，所以退出码 0 只说明单元骨架测试通过，不说明 AC-033 的“后端失败”“凭据状态”两项成立。brief.md 第 23 行将集成测试列为“缺一不可”。因此 CI 结果与 brief 要求矛盾，该项无法确认。

## Findings

### F1 [P0] 集成测试文件仍缺失
`test/integration/secret-backend-failure.test.mjs` 不存在（brief.md:23）。验收命令因 node 不校验路径存在而假绿。

### F2 [P0] 凭据后端失败 / 凭据状态仍无生产实现
`E_SECRET_BACKEND` 在 lib 下只出现在 `lib/contract/registry.mjs:104` 的注册表；没有 `lib/secrets` 后端、没有 `lib/commands/auth`。impl.md 自述未实现。

### F3 [P1] inline.mjs 未接入 loadConfig，且使用未注册错误码
- `lib/secrets/inline.mjs:46` 返回 `E_INLINE_SECRET`；注册表（`lib/contract/registry.mjs:96`）只有 `E_CONFIG_SECRET_INLINE`。design.md 禁止新增错误码。单元测试第 32–38 行固化了这个未注册码。
- `lib/config.mjs:83–94` 自带独立的 `checkSecrets`，不调用 inline.mjs；两套规则不一致（键名集合不同；config.mjs 拒绝任何非 SecretRef 的非空值，inline.mjs 只拒绝 `sk-` 前缀或 32 位以上字符串）。若接入将收窄既有检测能力，违反 design.md“不因本任务收窄已有明文检测能力”。

### F4 [P1] 追踪分片 `test/traceability/T-034.json` 缺失
brief.md:24 要求；Glob/ls 无结果。该路径不在 design.md write_scope 内，与 brief 冲突，需调度器裁决。

### F5 [P2] 单元测试覆盖偏弱
只调用 inline.mjs 导出，未经 loadConfig 生产入口；未覆盖大小写不敏感、合法 SecretRef、数组内 SecretRef。

### F6 [P1] 规格冲突仍未消解，导致 dev 空转
brief.md 要求实现并让两个测试通过；design.md 要求暂停至 T-013 合并，acceptance.md 仅一条命令且未补全。dev-r2 按 design 暂停，没有产出，因而 r2 与 r1 相比零进展。调度器需先二选一：(a) 确认 T-013 合并并让 design/acceptance 恢复；(b) 修订 design，允许在不依赖 T-013 后端的前提下实现 brief 要求。在此之前继续迭代 dev 不会改变结论。

## 结论

0/1，needs_revision。CI 的 `AC-033 OK` 来自缺失集成测试的假绿，不能作为通过证据。
