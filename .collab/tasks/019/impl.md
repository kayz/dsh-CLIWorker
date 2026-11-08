# T-019 实现记录

## 已完成

- 新增 `lib/catalog.mjs`，对显式传入的归一记录实现目录合并、白名单过滤、别名解析、等级来源优先级和弃用拒选的初步纯计算；输入通过克隆保护。
- 新增两个单元测试文件，分别检查白名单过滤和等级来源优先级的部分情形。

## 未完成及原因

- 当前工作树没有 T-017 的 `lib/models/**`、公开归一接口或缓存位置。按设计不能自行发明缓存协议，因此尚未将目录接入真实 `models list` 或实现四个管理写命令。
- 当前纯计算尚未覆盖设计的全部配置来源证据、完整 model/v1 校验及所有冲突处理；测试也未覆盖验收要求的全部情形。不能将两个 AC 标为 covered，故未创建 T-019 追踪分片。

## 自测

- `node scripts/run-tests.mjs --ac AC-045`：退出码 0，执行 1 个测试；仅验证上述部分行为，不代表 AC-045 验收通过。
- `node scripts/run-tests.mjs --ac AC-046`：退出码 0，执行 1 个测试；仅验证上述部分行为，不代表 AC-046 验收通过。
- acceptance 中的追踪检查退出码 1：缺少尚不能如实标记 covered 的 `test/traceability/T-019.json`。
- 未运行 `scripts/check-fast.ps1`：其调用的 `scripts/check-write-scope.mjs` 会执行 Git，与本任务禁止执行 Git 的指令冲突。
