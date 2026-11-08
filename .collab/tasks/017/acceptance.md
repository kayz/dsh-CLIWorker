# Task 017 — 按 CLI 分别实现模型枚举，失败时回退到手工补录，禁止写死模型表

## AC-041

- 命令: `node C:/git/dsh-CLIWorker/.collab/worktrees/017/scripts/run-tests.mjs --ac AC-041; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望: 退出码 0；输出包含 run-tests: filtered 1 files，对应 test/unit/enumerators.test.mjs，实际测试数大于 0，fail、cancelled、skipped、todo 均为 0，无 run.no_match。每个命令独立启动，报告由既有运行器写入系统临时目录，不要求提前运行 discover、安装 CLI 或设置真实凭据。单测必须以可观察结果逐项证明以下行为：
  - T-016 的 11 个已知 CLI 每个均有独立枚举器及至少一种成功策略的夹具；更换外部列表中的模型 ID 后输出同步改变。已启用策略分别覆盖成功、失败和后续策略接管，来源只取实际获胜策略。未知和 gone 条目不执行。
  - 全部自动策略失败时退出 0，并给 W_MODELS_MANUAL_REQUIRED；有已补录模型时 source.kind=manual，无补录时为空列表和警告，不虚构 ID。一个 CLI 失败不影响其他 CLI 的有效模型。
  - 所有输出记录满足冻结 model/v1 的全部必需键、禁止额外键与嵌套值域；特别断言 id、cli、vendor、capabilities.context_tokens/readonly/stdin、source.kind/ref/at。固定时钟得到固定时间；缺失能力/价格的候选不靠虚构默认值通过。去重和排序稳定，空/非法 ID、坏 JSON、空列表、超时及非零退出有明确断言。
  - 真实 bin/cliworker.mjs 接通 models enumerate 与 models add。隔离配置下执行 add --request-file 后，从新 CLI 进程 models list 可找到相同 key/id；再次 enumerate 在自动失败时返回同一手工记录及 source.kind=manual。持久化只使用既有 catalog.manual 与 v2 字段，未自动扩展 allow 或授予 verified/callable；重复添加不重复，其他配置保留，非法请求及写入失败不改变源文件。
  - 直接运行 enumerate 流程步骤成功，既有 harness 能发现它；使用同一临时状态并恢复共享配置；exec/fetch/缓存/异常中的哨兵在 stdout、stderr、argv、状态及来源字段均零命中。两项新命令的可达性不得仅用模块直接调用代替。

## AC-042

- 命令: `node C:/git/dsh-CLIWorker/.collab/worktrees/017/scripts/run-tests.mjs --ac AC-042; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望: 退出码 0；输出包含 run-tests: filtered 1 files，对应 test/unit/check-no-model-table.test.mjs，实际测试数大于 0，fail、cancelled、skipped、todo 均为 0，无 run.no_match。测试启动真实检查脚本，逐个验证 invalid 样例非零且诊断含文件及行号，valid 样例为 0；覆盖字符串列表、模型对象数组、模型键字典、Set/Map、默认/回退字面量、无厂商前缀 ID、多行、嵌套和无插值模板字符串，且 CLI/vendor 映射、参数、来源枚举、schema、注释与动态模型输入不误报。缺目录、读失败及错误参数不得报成功。只对一个违规样例做字符串匹配或仅测内部函数不满足本条。

- 命令: `node C:/git/dsh-CLIWorker/.collab/worktrees/017/scripts/check-no-model-table.mjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望: 退出码 0；stdout 含精确字符串 check-no-model-table: ok (0 model id literal tables)，无 FAIL 诊断；实际扫描由脚本位置确定的仓库 lib，不因调用方位于 TEMP 目录而扫描空目录，不借文件排除规则放过模型表。

- 命令: `node C:/git/dsh-CLIWorker/.collab/worktrees/017/scripts/check-no-model-table.mjs --root C:/git/dsh-CLIWorker/.collab/worktrees/017/test/fixtures/model-table/invalid; if ($LASTEXITCODE -ne 1) { throw 'expected model-table violation exit 1' }`
- 期望: node 进程退出码精确为 1；stdout 至少一项 FAIL 诊断含违规样例相对路径与行号，并包含 check-no-model-table: FAILED，不含零违规成功行。PowerShell 的条件检查仅在预期负例确实被拒绝时正常结束；任何启动失败、参数错误或目录不存在都不能替代正确的违规诊断。命令直接读取仓库内提交的违规夹具，不依赖上一条命令的产物。

## 建议验收方向

- 命令: `pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/017/scripts/check-fast.ps1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望: 退出码 0，输出 check-fast: ok；自动发现新的 check-no-model-table 并执行完整测试。这是下游实现完成后的项目集成检查，不新增 AC，也不能替代上述独立验收。全项目失败须保留实际诊断与归属，不能改验收、越界修复或将失败包装为成功。design 阶段不执行会写报告或可能调用 git 的检查链。

brief 未提供基准 commit SHA 或既有验收报告路径。本验收以本次设计指定的可观察结果与仓库内冻结契约为依据，不引用其他任务的通过报告。T-017 追踪分片仅登记 AC-041、AC-042，按 design.md 的既有格式填写；上游 T-015/T-016 尚未交付时不得跳过其 11 CLI 覆盖要求。
