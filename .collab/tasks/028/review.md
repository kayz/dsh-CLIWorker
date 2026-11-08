# Task 028 评审

评审对象：分支 task/028，HEAD `63e52f8d088847a6c08a9a8da3fcd1461d52db7f`（读自 `.git` 引用文件，未执行 git）。
结论：**pass**，AC 通过数 2/2。

## 证据口径

`ci-results.json`（ranAt 2026-11-09T05:02+08:00，passed 2 / total 2）：

- AC-067：exitCode 0，lastLine `AC-067 OK`，耗时 45.05s。输出中含 `check-docs: ok` 与 `check-fast: ok`，说明 AC-067 的五条命令（checker、集成测试、迁移覆盖断言、unit 回归、check-fast）都跑完。
- AC-068：exitCode 0，lastLine `AC-068 OK`，TAP 显示 tests 1 / pass 1 / fail 0。
- `notice.json`（21:00Z，ci 1/2）早于上述 CI 结果，是过期记录，不作为结论依据。

## 逐条核对

### AC-067

| 判据 | 结论 | 证据 |
| --- | --- | --- |
| checker 真实执行可运行片段并输出 `check-docs: ok` | 满足 | CI 输出；`scripts/check-docs.mjs:164-186` 要求 `count`、`readmeCount`、`docsCount` 均大于零，直接执行才运行（`:184`）。`runBlock`（`:94-142`）在仓库外临时夹具中用 `process.execPath` 启动 CLI（`spawnSync`，无 shell）。选模要求非空 `calls` 和数量匹配，随后执行返回的调用，逐行校验事件流，并检查 fake-cli 调用记录。 |
| README 无被忽略字段 | 满足 | `README.md:11,21,26` 的请求只含 `schema`、`request_id`、`level`、`count`、`usage`、`importance`。checker 对内联 `--request`、独立 JSON 和执行时的请求都用 `normalizeRequest` 检查 `W_FIELD_IGNORED`（`check-docs.mjs:64-74,102,113,118`）。 |
| 迁移覆盖 | 满足 | `docs/migration.md:3-21` 的五个三级小节与 `registry.snapshot.json.semantic_change` 完全一致，均有正文。映射表 32 行（10+15+7）。我读源文件独立调用 `checkMigration`，输出 `migration ok`。检查器逐项比较来源和目标，空目标要求“移除”（`:21-26`）。 |
| 集成测试含失败样本 | 满足 | `test/integration/docs.test.mjs` 覆盖缺段、缺行、逐项错目标、未知字段、非零退出、超时（`timeoutMs:1`）、坏标记、未闭合围栏、空块、事件流终结、凭据、无效链接、绝对路径、零可运行片段、CRLF、含空格的临时目录（`cw-doc space-`）。导入不执行检查（`:64-69`）。 |
| unit 回归与 check-fast | 满足 | 引用 CI。 |
| 文档事实与实现一致 | 满足 | 阈值与注册表 `thresholds` 一致（tasks 0/2/5，fraction 0/0.05/0.15，priority tasks→usd→fraction→unknown）。`docs/ui.md` 的头名与校验顺序对应 `lib/http/guard.mjs:7-14` 和注册表的 E_ADMIN_REQUIRED、E_READONLY、E_CSRF、E_LOOPBACK_ONLY。`startSession` 和 `resumeSession` 的签名对应 `lib/session.mjs:232,284`。`docs/platforms.md` 的 Windows 配置路径小写化对应 `lib/paths.mjs:29`。 |

### AC-068

- `docs/agentline-integration.md` 中 `level`、`count`、`usage`、`importance` 的取值、默认值和大小写规则与 `lib/request.mjs` 一致：importance 区分大小写（精确匹配 normal/high），level 和 usage 不区分。
- 文档说明了 `calls` 按顺序执行、保留字段含义、参数数组不拼 shell、stdin 输入和事件流（`:5`），再申请与 `exclude_handles`、`request_id` 重放（`:7`）。
- 错误码的 exit 和 retryable 与注册表一致：E_REQUEST_INVALID 等 2 项；E_NO_CANDIDATE 5 不可重试；E_INSUFFICIENT_QUOTA 5 可重试；E_LEASE_* 6，仅 EXPIRED 可重试；E_TIMEOUT 4 可重试；E_PROVIDER_* 7 不可重试。路由 `POST /cliworker/select` 对应 `lib/http/routes.mjs:3`。
- 禁词扫描：CI 中单元测试通过（0 命中，逐键正反例）。文档不含独立的禁词键；`E_PROVIDER_*` 因整词边界不误报。

## Findings

无 P0/P1。

- P2（不阻塞）：各专题文档偏简短，`docs/platforms.md` 没有可运行片段，也没有单列真机命令。设计要求的是“至少 README 与 docs 中各一段”，`docs/ui.md` 已有，故不构成缺陷。
- P2（不阻塞）：`impl.md` 自述 pwsh 和 Git 环境受限，未原样跑 unit 回归和 check-fast；这两条已由编排方 CI 在 pwsh 7 下跑过并通过，不影响结论。
