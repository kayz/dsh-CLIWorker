# Task 031 — 身份证据契约：四档身份、identity_source、calls[] 证据与 unverified 不阻断

## 目标

按 design.md 第 11 节实现身份证据契约。AgentLine 已回退 modelResolved 兜底，身份判定统一归 CLIWorker。

## 约束

- 只允许写入：lib/identity.mjs、lib/providers/call.mjs、lib/contract/views.mjs、test/contract/identity.test.mjs、test/unit/identity-levels.test.mjs
- 零第三方依赖；evidence 必须经 redact，不含令牌与用户名。

## 建议验收方向

- AC-075（levels: contract, unit）：四档身份 + identity_source；codex rollout 只记 observed；unverified 不阻断；failed 才降级；calls[] 证据字段齐全。
- 验收命令：node --test test/contract/identity.test.mjs test/unit/identity-levels.test.mjs
