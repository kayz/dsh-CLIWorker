# Task 039 评审

- 评审 sha：772bf1c1abf645ae03f9699681478d241b49fa5c（task/039，只读取自 .git 元数据）
- 结论：**pass**，通过 2 / 总数 2（AC-082、AC-006）；CI 记录 2/2
- 证据口径：执行类项引用 `ci-results.json`（编排方已用 PowerShell 7 执行）；其余项只读核对源码。

## AC-082 flow 真实执行 discover 并验证 inventory 同源 — 满足

| 要求 | 核对 |
|---|---|
| 步骤接口 | `test/flows/steps/discover.mjs:5-7` name='discover'、introduced_by='T-039'、ac=['AC-082']，异步 `run(flow)` |
| 独立 v2 配置 | `discover.mjs:10-26` 写入 `flow.root/discover.config.json`，schema `cliworker.config/v2`，`state_dir=flow.state_dir`，discovery/catalog/pools/policy/secrets 齐全，`catalog.manual: []`；不改 `flow.config_path` |
| 真实 CLI + 环境隔离 | `discover.mjs:27` `flow.run([...], {env:{PATH:'',Path:''}})`；`test/helpers/flow.mjs:194-195` 用 `process.execPath` 绝对路径；wsl:false、probe_unknown:false |
| 断言 | `discover.mjs:28-37` 退出码 0；stdout 与落盘 `inventory.json` 的 schema、entries 数组、generated_at 有效时间；`deepEqual`；无 catch 跳过 |
| 步骤顺序 | `test/helpers/flow.mjs:18-28` STEP_ORDER 中 discover 位于 doctor 与 enumerate 之间 |
| flow.test.mjs | `:11-13` 独立 readdir 派生 expectedNames；保留 AC-031 自测、顺序、元数据、泄漏、清理；`:81-121` 新增 `[AC-082]` 用例，核对 argv 中 `--config` 在 flow.root 内且非共享配置、v2、state_dir、同源、共享配置字节不变、cleanup 后 root 不存在 |
| flow-complete.test.mjs | `:10-20` 磁盘派生 + STEP_ORDER 逐项存在性，删除固定八项集合；`:30-47` 保留 sentinel、每步 ok、report.ok、leak 与五个扫描表面 |
| 追踪 | `test/traceability/T-039.json`：T-039 / M3 / AC-082 covered / `test/flows/flow.test.mjs`；`contracts/spec/ac-index.json:1007-1009` 登记一致 |
| CI | `ci-results.json` AC-082 exitCode 0，末行 `AC-082 OK`；输出含 `check-fast: ok`、`npm test` 881 通过 0 失败（含 `[AC-082]` 与 `[AC-071]` 用例）、check-traceability / check-write-scope / check-no-collab ok |

## AC-006 既有单元测试 — 满足

`ci-results.json`：exitCode 0，`AC-006 OK`，532 pass / 0 fail / 0 skipped。

## Findings

- **F1（P2，非阻塞）** `impl.md:10-11` 记录的自测结果（单元 526/5 失败、check-fast 在 check-pack 失败）与 CI（532/532、`check-fast: ok`）不一致，属记录过期；以 CI 为准，无需代码改动。

## 说明

- 评审环境未执行 git 命令；"未改 lib/ 与共享 fixture"由 CI 的 check-write-scope ok 及对 `flow.config_path` 的字节不变断言间接确认，源文件读取中未发现对 lib/ 的引用性改动。
- 未发现放宽既有断言的迹象。
