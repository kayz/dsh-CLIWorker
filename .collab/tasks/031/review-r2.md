# Task 031 — 评审（第 2 轮）

评审基于 git sha `f5e7318d5e29161d3bc05ab990eb5cda7d78f98b`（读取分支 ref，未执行 git 命令）。

结论：**pass**。AC-075 通过数 1/1。第 1 轮的 F1、F2 已修复，F3 已有独立运行证据。

## 第 1 轮 findings 复核

- **F1 [P1] 大小写**：已修复。`lib/identity.mjs:31` 的 `USER_DIR_RE` 现为 `/((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/\r\n]+/gi`，带 `i` 标志。独立探针（经 `classifyIdentity` 入口，rollout 文件）：
  - `c:\users\alice\r.jsonl` → `c:\users\[REDACTED]\r.jsonl`
  - `/HOME/bob/r.jsonl` → `C:\HOME\[REDACTED]\r.jsonl`（path.resolve 加了 cwd 盘符，用户名已去除）
  - `C:\USERS\Dave\a` → `C:\USERS\[REDACTED]\a`
  - `\\?\C:\Users\Zed\r.jsonl`、`\\srv\share\Users\Fay\r` 也都去除了用户名。
- **F2 [P2] 含空格的用户名**：已修复。用户名部分改为 `[^\\/\r\n]+`，取到下一个分隔符。探针：`C:/Users/John Smith/r.jsonl` → `C:\Users\[REDACTED]\r.jsonl`，姓和名都不残留。
- **其他字段**：`observed_at` 里的用户目录（`C:\Users\Eve\z`）同样被替换；`requested_model`、`reported_model` 经 `scrub`（`identity.mjs:116-118`），`evidence` 整体经 `redact`（`identity.mjs:183-187`）。`callWithIdentity`（`lib/providers/call.mjs:240-251`）的 `calls[].evidence` 直接取自该已脱敏对象，所以 calls 与 identity 两条路径都覆盖。
- **测试未削弱**：`test/unit/identity-levels.test.mjs:303-312` 新增断言，要求结果不含 `John`、`Smith` 且路径含 `[REDACTED]`；原有 Windows、POSIX、macOS 脱敏测试仍在。
- **F3 [P2] 兼容回归缺证据**：`ci-results.json` 仍只含 AC-075 第一条命令（`passed:1 / total:1`，`# tests 22 / # pass 22`，其余计数 0，末行 `AC-075 OK`）。本轮我独立只读运行了 `node --test` 对 `test/contract/identity.test.mjs`、`test/unit/identity-levels.test.mjs`、`test/contract/session.test.mjs`、`test/unit/session-invalidation.test.mjs` 四个文件：`# tests 48 / # pass 48 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（22 + 26）。Session 兼容命令因此有了实测证据，不再阻断。另运行 `node --test "test/unit/*.test.mjs"`：398/398 通过，其余计数 0。

## AC-075 逐条核对

- **执行证据**：`ci-results.json` AC-075 退出码 0，22/22 通过，与代码无矛盾，采信。
- **四档映射**：`identity.mjs:17-24` 与 11.1 表一致（三个 stdout 来源 verified，rollout-file observed，cli_flag/none unverified）。
- **失败优先**：`identity.mjs:133` 在 `ok !== true` 或有限整数非零退出码时先返回 failed；exec 抛异常时 `call.mjs` 置 `result=null`，得到 failed，且不外泄异常文本。
- **cli_flag/none 不造报告模型**：`identity.mjs:140-143` 返回 `reported:null`。
- **unverified 不阻断、模型不一致不降级**：读取失败、坏行、空模型均回到 `unresolved()`；`consistent` 只在 Session 投影里计算（`identity.mjs:213`，用脱敏前原值比较）。
- **点路径安全与 stdout 解析**：`valueAtPath`（`identity.mjs:42-54`）仅读自身属性并拒绝 `__proto__`/`constructor`/`prototype`；`jsonValues` 先整段 JSON，再逐行 JSONL，坏行不掩盖后续有效行。
- **calls[]**：键集合与 11.3 一致；exec 只调用一次；latency 只用 `ctx.clock.now()` 差，回退或非有限值取 0；tokens 只接受非负整数，真实 0 保留；`outcome` 与 failed 一致。
- **视图**：`views.mjs:80-117` 为纯白名单投影，`evidence` 每次新建，无 import；`sessionView`、`resolveView`、`VIEW_NAMES` 未变。
- **Session 兼容**：`call.mjs` 的 `classifyIdentity` 转调 `classifySessionIdentity`，仍返回四字段；`extractSessionId` 复用共享解析，26/26 回归通过。
- **写域**：本轮改动只涉及 `lib/identity.mjs` 与 `test/unit/identity-levels.test.mjs`，均在 write_scope 内。

## Findings

无。

## 备注（非阻断）

`ci-results.json` 未包含 Session 兼容命令；建议编排方后续在 CI 里补录，但已有本轮独立运行证据。
