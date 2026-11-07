# Task 033 — HTTP 直连 provider：DeepSeek 官网接入、身份与用量、凭据引用

## 目标

为 CLIWorker 增加 transport=http 的 OpenAI 兼容 provider，首个接入 DeepSeek 官网（api.deepseek.com）。实测：deepseek-flash 525ms、deepseek-v4-pro 1073ms，响应自带 model 与 usage。

## 约束

- 只允许写入：lib/providers/http-openai.mjs、lib/providers/registry.mjs、lib/usage/ledger.mjs、test/contract/http-provider.test.mjs、test/unit/http-usage.test.mjs
- 凭据只接受引用（env / vault），禁止明文落盘或打印。
- 同一模型的两个来源（codebuddy 与官网）必须分池记账。

## 建议验收方向

- AC-078（levels: contract, integration）：HTTP provider 契约、身份 verified、usage 精确记账、凭据引用、错误码映射。
- 验收命令：node --test test/contract/http-provider.test.mjs test/unit/http-usage.test.mjs
