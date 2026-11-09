# Task 043 实施记录

已在快照中读取并校验 probe 与 inventory，按观察投影六字段问题；仅在规则声明有效最低版本时比较语义版本，仅对有明确引用的 provider 调用现有凭据读取接口。页面从 snapshot 渲染问题与空状态，保留既有轮询和旧组件渲染；unknown 兜底增加空 issues 数组。新增集成测试覆盖真实 probe、discover、snapshot、页面、版本比较及受控凭据接口，并扩展现有快照测试。

自测结果：

- `node --test test/integration/discovery-probe.test.mjs`：通过，9 项。
- `node --test test/integration/issues-from-probe.test.mjs`：通过，4 项。
- `node --test test/integration/ui-snapshot.test.mjs`：通过，9 项。
- `node --test "test/unit/*.test.mjs"`：退出码 0，534 通过、1 个既有跳过。
- `node scripts/run-tests.mjs --ac AC-086`：退出码 0，4 项通过。
- `node scripts/check-traceability.mjs`：退出码 0，`check-traceability: ok`。
- `node scripts/check-acceptance.mjs .collab/tasks/043/acceptance.md`：退出码 0，`acs=1 commands=7`、`warnings=0`。

## 第 2 轮

有实际 discover probe 记录时，在既有 source 的 config/probes 描述后追加 discover 来源；页面据此在仅有成功 discover、问题列表为空时显示来源已接入及空状态。没有 discover 证据时 source 保持原值。补充真实 snapshot 测试，覆盖 env、session、受控 keychain 的缺失与存在、同 provider 多模型去重和不同 CLI、后端失败时页面保留、敏感哨兵、HTML 转义及 discover 失败证据。运行状态均在系统临时目录并清理。

本轮自测：`node --test test/integration/issues-from-probe.test.mjs` 6 项通过；`node --test test/integration/ui-snapshot.test.mjs` 9 项通过；`node --test "test/unit/*.test.mjs"` 退出码 0，534 通过、1 个既有跳过；`node scripts/run-tests.mjs --ac AC-086` 6 项通过；`node scripts/check-traceability.mjs` 输出 `check-traceability: ok`。

尚不能宣称完整验收通过：`node scripts/check-fast.mjs` 会调用 `scripts/check-scope-visible.mjs`，后者执行 `git check-ignore`，与本次禁止执行 git 命令的明确要求冲突，因此未运行。未执行 git 命令或提交；其他未在本轮重跑的命令沿用上轮记录，不视为本轮结果。
