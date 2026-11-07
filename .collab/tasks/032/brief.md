# Task 032 — Session 协议：start/resume 契约、六种失效条件、增量输入与额度耗尽路径

## 目标

按仓库根目录 SESSION-MANAGEMENT.md 实现 session 协议。CLIWorker 只出协议、不持有 session；AgentLine 存 session_id 与生命周期。

## 约束

- 只允许写入：lib/session.mjs、lib/providers/call.mjs、lib/contract/views.mjs、test/contract/session.test.mjs、test/unit/session-invalidation.test.mjs、test/integration/session-quota.test.mjs
- 零第三方依赖；session_token 不透明，不得泄露 provider / CLI 路径 / 模型 id。
- CLIWorker 不保存对话、不保存 session_id。

## 建议验收方向

- AC-076（levels: contract, unit, integration）：start/resume 契约、token 不透明、resume 返回身份证据四档、六种失效条件各返回固定错误码且不自动重试、增量输入只发 diff/摘要、额度耗尽时 E_SESSION_QUOTA_EXHAUSTED 并换模型新建、角色策略落盘 sessions/<role>.json。
- 验收命令：node --test test/contract/session.test.mjs test/unit/session-invalidation.test.mjs test/integration/session-quota.test.mjs

## 非目标

- 不实现 AgentLine 侧的 session 生命周期与 session_id 持久化。
- 不解析各 provider 的 resume 参数之外的行为。
