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

尚不能宣称完整验收通过：`node scripts/check-fast.mjs` 会调用 `scripts/check-scope-visible.mjs`，后者执行 `git check-ignore`，与本次禁止执行 git 命令的明确要求冲突，因此未运行。新测试尚未覆盖验收要求中的所有组合，特别是所有凭据后端通过真实 snapshot 的失败保留、多个 CLI 去重及 discover 空问题时的来源提示。当前页面以原 snapshot 的 source 字符串和问题列表判断来源；仅有成功 discover 记录且没有问题时不能识别已接入来源。未执行 git 命令或提交。
