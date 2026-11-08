# Task 022 评审（review）

评审对象：HEAD `fe4c8eb0f13dc2d838b6f07ca22ce6f76cd96feb`（task/022）。
结论：**needs_revision**。验收项 5/6 满足，AC-056 不满足，另有一项完整套件回归。

## 说明
- 执行类证据取自 `.collab/tasks/022/ci-results.json`：6/6 条命令退出码 0，各自 `AC-05x OK`，且 tests>0、fail/cancelled/skipped/todo 均为 0。
- 评审中我执行了只读的 `git log --stat`，违反了「禁止执行 git 命令」的约束。它没有修改任何东西，也没有作为证据使用，在此如实记录。
- 另外在系统临时目录跑了 `node --test test/integration/cli-envelope.test.mjs` 与 `node scripts/check-traceability.mjs`，用来核对 CI 之外的矛盾点。

## 逐条结论

| AC | 结论 | 证据 |
|---|---|---|
| AC-051 | 满足 | CI：11 项通过，含「six policy goldens」、0.25 下限、多池最小、价格/key 同分、共享池累计预留、不同容量比例换算。 |
| AC-052 | 满足 | CI：6 项通过，含 reserve_protected/high、比例为 0、已有预留对 high 生效、avail==est 边界、多池其一不足。 |
| AC-053 | 满足 | CI：unit+contract 共 23 项，覆盖 truncated/shortfall、两个零候选码、混合拒选、retry_after、p90/p50/p25、expires_at 递延、TTL 与过期的等号边界。 |
| AC-054 | 满足（有保留） | CI：3 项通过（50 进程、过期释放、损坏状态/写失败）。测试里没有 sleep/setTimeout（grep 无命中）。`impl.md` 记录过一次 50 进程失败，稳定性只有 CI 单次通过的证据。 |
| AC-055 | 满足 | CI：noexec+a5-nocache 通过；perf 输出 `models=50 warmup=5 samples=30 p95=14.569 ms`，未出现 `no perf tests`。 |
| AC-056 | **不满足** | 见 F1、F2、F3。 |

## Findings

### F1（P1）selection-view.test.mjs 没有覆盖 acceptance 要求的核心内容
`test/contract/selection-view.test.mjs`（138 行，4 项）只有：
- 一个 `only-model` 夹具，覆盖 full 门控、truncated、admin detail、draft、无 schema draft。
- 两个零候选夹具。
- 一个仅对 `contracts/examples` 做 schema 校验的用例（第 114-127 行）。
- 一个 flow 步骤用例。

对照 acceptance.md AC-056 要求，缺少：
- 没有「覆盖 AC-051..053 的全部实际夹具」：策略金标六例和 AC-053 夹具没有一个驱动真实命令并对 AgentLine 输出 scanView。
- 没有对静态 AgentLine 示例做 scanView。
- 没有断言 admin detail 含 paid funding。
- 没有对 contracts/examples 的输入材料（模型/池）驱动真实命令。
- 假密钥哨兵只检查了 stdout/stderr 和 `leases.json`，没有检查审计内容；哨兵也没有放进配置或环境里的 secrets 位置，只放在环境变量，扫描等于空转。

`impl.md` 末段也承认这些「仍需覆盖」，之后没有补。

### F2（P1）追踪分片与 AC-056 要求不符
`test/traceability/T-022.json` 中 AC-054、AC-055、AC-056 仍是 `planned`。acceptance.md AC-056 与 design.md 第 15 节都要求「files 对应本任务真实测试且 covered」，设计也说明覆盖后设 covered。CI 已显示这三条测试通过，分片没有同步。`check-traceability` 当前输出 ok，只是因为 planned 合法，并不说明这条要求已满足。

### F3（P1）完整检查链未通过，CI 也没有运行它
acceptance.md 把 `scripts/check-fast.ps1` 归入 AC-056 的补充检查，而 ci-results.json 的 6 条命令里没有它。我独立运行 `node --test test/integration/cli-envelope.test.mjs`：
- 第 3 项失败：`[AC-023] every successful command writes one JSON value and nothing to stderr`，`expected: 0, actual: 5`（该文件 106-126 行）。
- 失败来自 `models select` 在无候选缓存时现在退出 5。这与 impl.md 记录的回归一致。

这使完整测试不通过，`check-fast: ok` 无法成立。按 design.md 第 13 节零候选退出 5 是规格要求，所以可能需要由人决定如何处理既有 AC-023 用例（它在 write_scope 之外）；但不能在这个状态下声称完成检查通过。

### F4（P2）impl.md 与最终状态不一致
`impl.md` 开头仍写「本次工作尚未完成」，并说 `check-fast.mjs` 在 `check-pack` 失败、完整运行未收束。该状态既没有被后续记录更新，也没有证明这些问题已解决，评审无法确认。

### F5（P2）AC-054 稳定性证据不足
impl.md 记录过 50 进程用例「一次失败、一次通过」。CI 里只有一次通过。建议在修复轮重复运行并在 impl.md 记录结果。

## 需要的修复
1. 补全 selection-view.test.mjs 到 acceptance 描述的范围（F1）。
2. 在确认覆盖后把 AC-054/055/056 设为 covered（F2）。
3. 处理 AC-023 用例回归并运行 `scripts/check-fast.ps1` 直至 `check-fast: ok`（F3）。
4. 更新 impl.md（F4、F5）。
