# Task 043 评审（round 2）

评审基准：HEAD `e1f6ca6`（来自会话 gitStatus 快照，未执行 git）。
结论：**pass**（通过 1 / 总数 1）。

## 证据

### 编排方 CI（ci-results.json）
- AC-086 `passed: true`、`exitCode 0`，但 `output` 仍只含 `test/integration/discovery-probe.test.mjs` 的 9 项 TAP 与末行 `AC-086 OK`，即只覆盖依赖检查命令。
- 其余 6 条命令无 CI 输出，按口径改用只读独立核验（不写文件、不执行 git）。

### 独立核验
- `node --test test/integration/issues-from-probe.test.mjs test/integration/ui-snapshot.test.mjs`：15 通过 / 0 失败 / 0 跳过。
- `node --test "test/unit/*.test.mjs"`：535 通过 / 0 失败 / 0 跳过。
- `node scripts/run-tests.mjs --ac AC-086`：6 通过 / 0 失败（上轮为 4 项）。
- `node scripts/check-traceability.mjs`：`check-traceability: ok (covered=79 planned=3)`。
- `node scripts/check-acceptance.mjs .collab/tasks/043/acceptance.md`：`acs=1 commands=7`、`warnings=0`。
- check-fast 的非 git 子检查逐个运行均为 ok：ci、contract-doc、defects、docs、frozen-files(8)、generated-fresh、golden-frozen(14)、no-collab、no-model-table、pack、seams(98 files)、test-discovery、unused。
- 未运行：`check-scope-visible`、`check-write-scope`（依赖 git，评审禁止执行 git）。因此 `check-fast.mjs` 整体退出码未亲自确认；按口径不以环境缺 git 为由判 needs_revision，其余子检查全绿，作为备注留给编排方。

### 上轮 finding 复核
- P1-1（来源提示）已修复：`lib/http/snapshot.mjs:50-52` 在存在有效 discover probe 证据时 source 追加 `, discover`；`ui/app.mjs:20` 据此显示"问题来源已接入"。测试 `discover failure evidence reaches the snapshot`（issues-from-probe.test.mjs:212 起）断言 `已接入` 且 `暂无有证据的问题`、无 `<article`。
- P1-2（真实入口覆盖）已补：
  - `snapshot checks configured credentials per provider and retains the page on backend failure`（:137）经真实 createPlugin/snapshot/startApp 覆盖 env/session/keychain 缺失与存在、无 secrets 配置时 keychainReads 为 0、同 provider 多模型与不同 CLI（claude/codex）去重、重复 GET id 稳定、`E_SECRET_BACKEND` 后页面保留旧条目并标 stale、probes 计数不增（GET 不执行探测）、哨兵（PRIVATE_/sentinel-secret-value/用户名目录）不出现、HTML 转义。
  - discover 失败证据（exit 非零）经 snapshot 得到 `unavailable`/`non-zero exit`，evidence_ref 含 digest，响应不含原始 stderr 或临时目录名。
  - 版本比较：`semver precedence…`（:72）与 `a declared minimum is applied by the real snapshot…`（:107）。
- P1-3（CI 证据）：CI 仍只含第 1 条命令，改由上面的独立核验补足。

### 实现与规格对照
- `lib/index.js:153`：unknown fallback 对象仅新增 `issues: []`，其余五项与控制流不变。
- `lib/http/snapshot.mjs:50-54`：返回 `{models, forecast, source, at, last_error, issues}`。
- `lib/http/issues-api.mjs`：六字段；id 为 kind/subject/identity 的 sha256，不含轮询时间；仅 `Object.hasOwn(config.secrets, provider)` 时调用 resolveSecret，每 provider 每轮一次，后端异常上抛；非法 minVersion 抛 `E_CONFIG`；`compareVersions` 处理 prerelease 与 build（:14-30）。
- `lib/discovery/rules.mjs` 未加入任何生产 minVersion。
- `ui/app.mjs` 只消费 `snapshot.issues`，沿用 `setTimeout(tick, 15000)`，无 SSE。

## Findings（均不阻塞）

### P2-1 文件头注释仍过时
- `lib/http/issues-api.mjs:1-2` 仍写 "No production issue source is currently defined… never inspect local files or infer issues from logs"，与 `projectProbeIssues` 的行为不符。上轮已提，未修；建议后续顺手改注释。

### P2-2 `blocked/auth` 计为 unavailable 仍无专门断言
- `lib/http/issues-api.mjs:62`；设计允许，且 `Object.hasOwn` 门控保证 auth 失败不会生成 missing-credential（secrets 测试中的 model 即为 blocked/auth，未配置 secrets 时 `missing-credential` 为 0）。已被间接覆盖。

## 逐项结论

| 项 | 结论 | 证据 |
|---|---|---|
| AC-086 | **通过** | 依赖命令见 ci-results.json；功能、ui-snapshot、unit 535、run-tests 6、traceability、acceptance 格式、check-fast 的非 git 子检查均独立通过；仅 git 依赖的 check-scope-visible/check-write-scope 未跑 |

通过数 / 总数：1 / 1。
