# Task 031 — 评审（第 1 轮）

评审基于 git sha `31685f25f0c371bee238bf841c35c0b0974dfe86`（读取 `.git/refs/heads/task/031`，未执行 git 命令）。

结论：**needs_revision**。AC-075 通过数 1/1（CI 证据），但独立核对发现身份脱敏有缺口，违反 design.md 11.2「evidence 不含用户名」。

## AC-075 逐条核对

- **执行证据**：`ci-results.json` 记录 AC-075 退出码 0，TAP 摘要为 `# tests 21 / # pass 21 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`，末行 `AC-075 OK`。与代码无矛盾，采信。
- **四档与来源映射**：`lib/identity.mjs:17-24` 的 `LEVEL_BY_SOURCE` 与 11.1 表一致。modelUsage、event.model、stats.models 为 verified，rollout-file 恒为 observed，cli_flag 与 none 为 unverified。
- **cli_flag 与 none 不造报告模型**：`identity.mjs:139-142` 直接返回 `reported:null`。none 即使 stdout 有 model 字段也不读取。
- **失败优先**：`identity.mjs:132` 在 `result.ok !== true` 或有限整数非零退出码时返回 failed，早于任何证据解析。`call.mjs:219-222` 在 exec 抛异常时置 `result=null`，得到 failed，且不外泄异常文本。
- **unverified 不阻断、模型不一致不降级**：读取失败、坏行、空模型都回到 `unresolved()`，即 unverified/none。`consistent` 只在 Session 投影里计算，不影响等级。
- **点路径安全**：`valueAtPath`（`identity.mjs:41-53`）只读自身属性，并拒绝 `__proto__`、`constructor`、`prototype`。
- **stdout 解析**：`jsonValues` 先尝试整段 JSON，失败后逐非空行解析 JSONL。坏行不会掩盖后续有效行。
- **calls[]**：`call.mjs:240-255` 的键集合与 11.3 表完全一致。
  - 只调用一次 exec，latency 只来自 `ctx.clock.now()` 前后差，时钟回退或非有限值取 0。
  - tokens 只接受非负整数，真实 0 保留，缺失或无效为 null。
  - outcome 与 `identity.level==='failed'` 一致。
  - evidence 每次新建对象。
- **视图**：`views.mjs:80-117` 的 `identityView` 与 `callView` 是纯白名单投影，不 import，`evidence` 深拷贝。`sessionView`、`resolveView`、`VIEW_NAMES` 未改。
- **Session 兼容**：`call.mjs:201-203` 的 `classifyIdentity` 转调 `classifySessionIdentity`，仍返回四字段。`extractSessionId` 复用 `jsonValues` 与 `readText`，行为不变。
- **写域**：impl.md 声明只动五个文件，`git status` 快照中除 `.collab` 外无改动。
- **兼容回归命令**：impl.md 自述 26/26 通过。CI 结果只含 AC-075 的第一条命令，所以该项只是采信实现者自述，没有独立运行证据（见 F3）。

## Findings

### F1 [P1] 用户目录脱敏对大小写敏感，小写 `users`、`home` 会泄露用户名

位置：`lib/identity.mjs:30`，`USER_DIR_RE` 没有 `i` 标志。

Windows 路径不区分大小写，`c:\users\alice\...` 是常见写法。我用 node 实测 `classifyIdentity` 处理 rollout 文件 `c:\users\alice\r.jsonl`，`evidence.path` 原样返回 `c:\users\alice\r.jsonl`，用户名 alice 泄露。`/HOME/bob/r.jsonl` 同样原样返回。

design.md 11.2 要求 evidence 不含用户名，11.1 要求「移除 Windows Users/<用户名>」。

建议：给正则加 `i` 标志，并补一条小写或混合大小写的测试。

### F2 [P2] 含空格的用户名只被部分脱敏

位置：`lib/identity.mjs:30`，`[^\\/\s]+` 在空白处截断。

实测 `C:\Users\John Smith\r.jsonl` 变成 `C:\Users\[REDACTED] Smith\r.jsonl`，姓氏泄露。Windows 用户名含空格很常见。

建议：Windows 反斜杠或盘符路径按到下一个分隔符为止脱敏，不在空白处停；POSIX 的 `/home/<name>` 可保持现状。补一条带空格用户名的测试。

### F3 [P2] 兼容回归命令缺少编排方执行证据

`ci-results.json` 只含 AC-075 的第一条命令（`passed:1 / total:1`）。acceptance.md 里的第二条 Session 回归命令只有 impl.md 的自述，没有独立运行记录。代码上看没有矛盾（`call.mjs` 保留了全部旧导出，`extractSessionId` 逻辑不变），所以不单独阻断，但需要在下一轮 CI 中补上这条命令的结果。

## 小结

功能主体符合 design.md 11.1～11.4，没有发现等级映射、失败优先、calls 字段和白名单视图方面的缺陷。唯一阻断项是 F1：脱敏不识别大小写，直接违反「evidence 不含用户名」。修复范围很小，限于 `lib/identity.mjs` 和对应测试，都在 write_scope 内。
