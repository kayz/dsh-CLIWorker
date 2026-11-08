# Task 034 - 配置明文拒载与凭据后端失败处理

从 T-013 拆出的独立任务：只负责 AC-033。

## 目标

- 递归检测配置中的内联明文密钥，拒载并给出明确错误码，同时保持既有配置兼容
- 凭据后端失败时给出可判定的错误与状态

## 约束

- 只允许写入：lib/secrets/inline.mjs、lib/config.mjs、test/unit/inline-secret.test.mjs、test/integration/secret-backend-failure.test.mjs
- 不新增 schema 字段；不依赖操作系统原生 keyring

## 建议验收方向

- AC-033（levels: unit, integration）：明文拒载、后端失败、凭据状态三项可判定。
- 验收命令：node --test test/unit/inline-secret.test.mjs test/integration/secret-backend-failure.test.mjs

## 必须创建的文件（缺一不可，验收会逐项检查）

- `lib/secrets/inline.mjs` —— 递归检测配置里的内联明文密钥
- `test/unit/inline-secret.test.mjs` —— 带 `[AC-033]` 标签
- `test/integration/secret-backend-failure.test.mjs` —— 带 `[AC-033]` 标签
- `test/traceability/T-034.json` —— 追踪分片

收工前必须让这两个测试文件都通过：
`node --test test/unit/inline-secret.test.mjs test/integration/secret-backend-failure.test.mjs`