# Task 034 评审（review）

- 评审对象 git sha：80ea1be（取自会话启动时的 git 状态快照；本角色不执行 git，未独立核对）
- 结论：**needs_revision**
- 通过数/总数：0/1（编排方 CI 为 1/1，但与代码矛盾，见 F1，故该项无法确认）

## 逐条核对

### AC-033 配置明文拒载与凭据后端失败处理 —— 未满足

CI 证据（ci-results.json）：退出码 0，最后一行 `AC-033 OK`，`# tests 5 / pass 5`。
独立核对结果：这 5 个用例全部来自 `test/unit/inline-secret.test.mjs`（用例名与该文件第 5、11、23、32、40 行一一对应），集成测试没有被执行，因为文件不存在。CI 绿灯只证明了单元骨架测试通过。

## Findings

### F1 [P0] 集成测试文件缺失，CI 绿灯不能证明 AC-033
- brief.md 第 23 行及验收命令均要求 `test/integration/secret-backend-failure.test.mjs`，带 `[AC-033]` 标签，并列为“缺一不可”。
- Glob `test/**/*{secret,T-034}*` 只返回 `test/unit/inline-secret.test.mjs`。ci-results.json 的 TAP 输出里没有任何集成用例。
- 因此「后端失败」「凭据状态」两项（brief 目标第 2 条、AC-033 三项可判定中的两项）没有任何测试，也没有生产代码支撑。
- 命令退出码 0 是因为 `node --test` 对不存在的路径没有失败，这是验收命令的盲区，不是满足。

### F2 [P0] 凭据后端失败 / 凭据状态没有实现
- lib 下 `E_SECRET_BACKEND` 只出现在 lib/contract/registry.mjs:104 的注册表里，没有任何生产代码抛出它；不存在 lib/secrets 下的后端，也不存在 lib/commands/auth。
- design.md 明确把恢复条件设为 T-013 合并，impl.md 也自述“尚未实现、尚未通过验收”。工作树里 T-013 依赖仍然缺失。
- “后端失败返回 E_SECRET_BACKEND、state_dir 不变、auth status 只暴露 set/unset”均无实现和证据。

### F3 [P1] inline.mjs 使用了未注册的错误码 `E_INLINE_SECRET`，且未接入 loadConfig
- lib/secrets/inline.mjs:46 返回 `code: 'E_INLINE_SECRET'`；契约注册表（lib/contract/registry.mjs:96）里只有 `E_CONFIG_SECRET_INLINE`（退出码 3）。design.md 禁止新增错误码。单元测试第 32–38 行把这个未注册码固化为期望。
- lib/config.mjs:83–94 自带一套 `checkSecrets`，并未调用 inline.mjs；两套规则不一致。config.mjs 的键名集合含 `access_token`、`auth_token`，inline.mjs 的含 `passwd`、`auth`、`apikey`；config.mjs 对任何非 SecretRef 的非空值都拒绝，inline.mjs 只拒绝 `sk-` 前缀或 32 位以上的字符串。
- 若今后接入 loadConfig，将收窄既有检测能力（如 `token: "short"` 现在被 config.mjs 拒绝，inline.mjs 放行），违反 design.md 第 30 行“不因本任务收窄已有明文检测能力”。目前也没有测试通过 loadConfig 验证 E_CONFIG_SECRET_INLINE 与合法 SecretRef 的兼容。

### F4 [P1] 追踪分片缺失
- brief.md 第 24 行要求 `test/traceability/T-034.json`。Glob 未找到。（注：该文件不在 design.md write_scope 内，与 brief 存在不一致，需调度器裁决；但 brief 写明“缺一不可”。）

### F5 [P2] 单元测试自身覆盖偏弱
- 仅测试骨架函数，未经 loadConfig 生产入口，未覆盖大小写不敏感、SecretRef 形态、数组里的嵌套 SecretRef。

### F6 [P2] 规格文件之间互相冲突
- brief.md 要求实现并让两个测试文件通过；design.md 要求暂停至 T-013 合并，且 acceptance.md 只有一条命令，未覆盖设计里提出的回归与项目检查。建议调度器先消解该冲突再进入下一轮。

## 结论

CI 的 `AC-033 OK` 与代码事实矛盾（缺失集成测试文件、缺失后端实现），该项无法确认通过。0/1，判 needs_revision。
