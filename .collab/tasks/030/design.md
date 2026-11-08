---
write_scope:
  - scripts/release-gate.mjs
  - release/**
  - test/unit/release-gate.test.mjs
  - test/fixtures/release-gate/**
  - test/integration/flow-complete.test.mjs
  - test/traceability/T-030.json
---

# Task 030 — 发布门禁与全流程完整性：baseline 来源、real-smoke 映射、豁免单列、skip 不算通过、追踪全部 covered

## 目标

以本任务 brief、Blueprint 中 T-030/AC-070/AC-071 和仓库现有格式为依据，实现离线发布判定和完整流程验证。此文件的 write_scope 是下游实现范围；design 阶段只写本任务的 design.md、acceptance.md。

沿用 `contracts/spec/ac-index.json` 的 `schema/acs`、条目的 `ac/owner/milestone/levels/baseline`；沿用追踪分片的 `task/milestone/entries` 和 `ac/files/status`，不增加 baseline。沿用 `test/smoke/report.mjs` 的报告与校验，不另建报告版本。豁免格式取自 Blueprint design.md 第 6 节：JSON 数组，每条恰为 `{ac, reason, approved_by, version}`；三个说明/版本字符串和 ac 均须有效，reason、approved_by 不得为空白。正式 `release/waivers.json` 提交内容为 `[]`。

`scripts/release-gate.mjs` 为独立 Node 20+ ESM 脚本，不注册 CLI 命令。命令沿用任务图的 `--ci-artifacts <dir> --smoke-report <file> --waivers <file>`，并沿用已有门禁的 `--root <dir>`、`--index <file>` 约定：root 默认仓库根，index 默认 root 下 `contracts/spec/ac-index.json`。前三个参数必须显式提供。命令行路径相对调用时 cwd 解析；索引及分片中的文件路径相对 root。未知参数、缺参数返回 2；输入缺失、格式非法、证据不足或规则失败返回 1；只有无阻断项才返回 0。不得依赖当前主机 OS、联网、CI 服务或隐式读取其它证据。

示例调用：`node scripts/release-gate.mjs --root . --ci-artifacts <dir> --smoke-report <file> --waivers release/waivers.json`。脚本只读输入并向 stdout/stderr 输出，不写报告文件，不执行测试或其他门禁。M5 的完整运行由既有 `milestone-gate` 单独执行。

## 约束

CI 证据目录约定如下，目录名仅用于区分 job，不参与 baseline 判定：ci-artifacts 下每个直接子目录是一份 job 证据，包含同次运行的 `files-executed.json`、`reporter.tap`、`skips.jsonl`。reporter.tap 使用 Node 内置 TAP reporter 原始输出，不引入自定义结果 JSON 字段；无跳过时 skips.jsonl 是空文件。每份清单沿用现有 `mode/filter/files/platform/node`。清单须为 `mode:'full'`、空 filter，platform 为索引允许的 OS，node 满足包的 Node 下限。相同 OS 的不同 Node 版本可提供多份证据。

当前 `scripts/run-tests.mjs` 只输出 spec reporter 与文件清单，现有 CI 上传清单和 skips；它们本身不构成完整发布证据。本任务不改 runner 或 workflow。证据提供者必须在同一次完整执行中同时保存 Node TAP reporter 与现有 files reporter 的输出，并按上述目录提供；缺 reporter.tap 明确阻断，禁止用文件存在、spec 摘要、skip 日志或另一次运行的 pass 补齐。夹具必须模拟真实 TAP（含嵌套、诊断、plan 和结束摘要），不能仅放一个伪造的“成功”字符串。

复用 `validateIndex`、`mergeShards` 的现有导出进行结构、唯一属主、covered 文件及 AC 标记校验；不导入 Blueprint，不硬编码 AC 总数，不忽略扩展索引中的 AC-079。任一索引/分片错误、无分片或 planned 均阻断；waived 不能替代 covered。收集 covered 条目的 files，以规范化的仓库相对路径匹配 manifest；拒绝越界路径。缺文件、坏 JSON、空证据目录、非法 TAP、截断 TAP、缺少结束 plan/摘要或不完整运行均明确阻断。汇总时保留所有错误，不遇首个 AC 失败就停止遍历。

CI 判定只针对索引要求的 baseline：按 manifest.platform 分组，禁止将 darwin 的 pass 计给 win32，也不得因当前机器是 win32 就跳过 linux。每个声明的 OS 必须有证据；covered 的 files 在用于证明该 AC 的完整 job 清单中全部出现，且对应运行时结果可归属到这些文件。结合 TAP 的文件子测试及诊断路径识别文件，结合实际运行的 `[AC-nnn]` 标记识别 AC；同名测试在不同文件不得串用。使用子测试最终状态，父 suite 的 ok、静态标题以及 TAP 诊断中的示例文字均不能作为 pass。支持 Node 20/22 常见嵌套与转义输出；`# SKIP`、`# TODO` 不算 pass，不能把 `not ok` 误读为 ok。skips.jsonl 沿用 `cliworker.skip/v1`，校验 file/ac/platform/node 并作为跳过的旁证，不能产生 pass，和 TAP 冲突则阻断。

同一 AC 在每个必需 OS 上至少一次完整 job 有实际 pass 才满足该 baseline；不要求每个 Node 版本都 pass。所有被提供的完整 job 中任何实际 fail（包括未标 AC 的测试失败或进程级失败摘要）仍阻断，不能以另一 Node 的 pass 抵销。同一 AC 在非必需 OS 的正常平台 skip 不阻断；必需 OS 只有 skip/TODO、无该 AC 结果、缺已登记文件或缺结果则阻断。纯 skip 的 job 不能充当另一 job 的 pass。额外 job 的损坏输入也不能静默忽略。

real-smoke 只用于索引包含 `real-smoke` 的 AC。按 `test/smoke/report.mjs` 的现有结构与 `validateReport(report, package.version)` 校验，要求 `mode:'real'`、`redacted:true`、version 与 root/package.json 严格相等，全部必需步骤齐全且有序。对每个 real-smoke AC，必须有步骤的 ac 数组显式包含它，所有匹配步骤都须 pass；不能用不带该 AC 的其它 pass 步骤、CI 中同 AC 的 pass 或全报告摘要代替。dry-run 永远不是 real-smoke 证据。AC-069 的 baseline 仍为索引里的 linux，不能因为它也出现在 real 报告中而免除 linux CI 证据。

报告中任一 fail 或 mandatory:true 的 skip 均为阻断，即使另一 AC/步骤 pass 或存在豁免也不能覆盖。报告提供但格式非法、redacted 不合格、版本不符或 dry-run，不能用豁免隐藏该输入错误。唯有指定 smoke 路径不存在、且所有需要 real-smoke 的 AC 均有当前版本有效豁免时，允许缺 real 报告；该情况逐条 waived 并说明报告缺失。若部分未豁免则逐条阻断未满足项。

豁免文件缺失或不是合法数组时阻断。未知 AC、重复 ac/version、非法字段或空审批信息阻断；对非 real-smoke AC 的条目直接阻断，不论条目版本。已过期版本条目不能放行当前版本，并在输出解释不适用；有效当前版本条目只解除对应 AC 的 real 证据缺失要求。有效豁免在最终报告中固定单列为 waived，即使有 pass 证据也不混入 PASS；它不消除索引/追踪错误、真实 fail 或 mandatory skip。脚本只验证审批字段，人工审批流程在本任务之外。

stdout 为可核对的文本，不新建机器报告 schema：按索引顺序逐 AC 输出 `PASS <AC>`、`BLOCKED <AC>` 或 `WAIVED <AC>` 开头的行，附 baseline、来源 job/报告或分片路径、版本及具体理由。通用输入错误用 `BLOCKED` 行指出文件与原因。结尾严格输出 `release-gate: PASS` 或 `release-gate: BLOCKED`；有豁免且无阻断时退出 0，但对应 AC 只有 WAIVED 行。PASS/WAIVED/BLOCKED 互斥，不能对同一 AC 同时报通过和豁免。诊断不回显输入原文或令牌。

不得修改 brief 列出的只读路径。只创建本任务追踪分片：`task:'T-030'`、`milestone:'M5'`，AC-070 对应 `test/unit/release-gate.test.mjs`，AC-071 对应 `test/integration/flow-complete.test.mjs`，均为 covered，测试含实际 `[AC-070]` / `[AC-071]` 标记。不调整其它分片或索引来通过 M5。

## 建议验收方向

AC-070 的单元夹具通过真正启动脚本、检查退出码与逐 AC 输出覆盖每条规则；纯函数测试可补充，但不能替代 CLI 验证。`test/fixtures/release-gate/<case>/` 每例均是独立 root，含 package.json、contracts/spec/ac-index.json、test/traceability、追踪指向的测试文件、ci 下 job 目录、smoke.json、release/waivers.json；故意缺失的文件不创建。package 版本从当前包取值，不固定新版本；fixture 索引沿用现有合法完整 AC 集合，状态变体只改变该例的输入。有效报告复用现有七步及 ac 映射，AC-038 对应 wsl-discover。不得把夹具的豁免复制到正式 release/waivers.json。

acceptance.md 中列出的 case 目录为稳定验收入口。good 证明所有基线均通过；ci-fail 证明其它 pass 不掩盖 fail；baseline-skip 和 wrong-os 证明 CI 不能跨 OS 记账；node-alternative 证明同 OS 另一 Node 的 pass 可补足 skip；dry-run、unredacted、wrong-version、unmapped-smoke、smoke-fail、mandatory-skip 证明 real 证据条件；waived-missing-smoke 证明缺报告有当前版本豁免可放行但单列；waived-mandatory-skip 证明豁免不能掩盖 mandatory skip；non-real-waiver、stale-waiver、planned、missing-smoke 证明相应阻断。missing-manifest、missing-reporter、missing-skips、filtered、missing-executed-file、missing-result、malformed-report、malformed-waivers、missing-waivers 分别隔离验证缺失/非法输入。

同一测试文件中还必须覆盖：索引/追踪非法、空 artifact 目录、重复属主、分片伪造 baseline、未知/重复豁免、空审批信息、TAP 嵌套/转义/同名/伪 pass/截断/TODO、skips 与 TAP 冲突、未标 AC 的 fail、全部匹配 smoke 步骤必须 pass、AC-069 不能用 real 报告替代 linux，以及只在非必需 OS 跳过的正常场景。所有用例离线、零第三方运行时依赖。

AC-071 复用 `discoverSteps/createFlow/runFlow` 和既有 leak-scan，对真实 `test/flows/steps` 严格断言顺序数组恰为 auth、doctor、discover、enumerate、probe、select、run、http-select、http-admin；不得只比较 discoverSteps 与它自己的返回值或允许子集。产出归属为 auth→T-013、doctor→T-024、discover→T-016、enumerate→T-036、probe→T-020、select→T-022、run→T-023、http-select/http-admin→T-024。enumerate 采用本仓库当前步骤和 T-036 产出，不能退回 Blueprint 早期 T-017。

只创建一个 flow，一次 runFlow 顺序执行全部真实步骤，共用 root/state_dir 和同一份哨兵；逐步检查 results 中 name、introduced_by、ok，并保持 env 中的同一哨兵身份。检查最终 leak.ok、hits 为空、errors 为空，并要求实际扫描了 argv/stdout/HTTP/state/audit 等本流程使用的表面，避免空扫描通过。凭据消费验证沿用 auth 步骤已有的哈希记录，断言子进程 env 实际收到同一哨兵对应的值且 argv 无值；不能只检查父进程 env 存在。授权 auth 导入时可经 stdin，提供给 CLI/provider 的凭据只经 env。额外扫描 flow.root 与累计 captured 表面，清理前断言；finally 调用 cleanup。失败消息不打印哨兵。

当前只读步骤目录仅八项，缺 discover.mjs；AC-071 和 M5 必须保持失败，直至 T-016 产物补齐。不得新增临时“成功”步骤顶替真实流程、改 steps 或放宽集合断言。此为已知上游缺项，不是需求歧义。

M5 收口直接执行 `node scripts/milestone-gate.mjs --milestone M5`：应输出 `milestone-gate M5: PASS` 并退出 0，由它验证里程碑范围内全部 covered、完整执行及 11 条缺陷的 fixed；本任务不复制其规则。另执行全单元回归及 `pwsh -NoProfile -File scripts/check-fast.ps1`。完整发布放行仍需另外提供合格真实 smoke 或人工批准豁免，夹具通过与本地 M5 通过不能宣称真实发布已通过。

## 非目标

不实现冒烟、不生成真实 CI/真机通过证据、不改 CI workflow、索引、registry、现有流程步骤和其他任务分片；不发布包、不做签名或性能门禁。brief 未给基准 commit 或既有验收报告路径，因此验收不杜撰它们。
