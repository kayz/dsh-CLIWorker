# Task 033 实现说明

## 交付范围

本轮只创建/修改 design.md front matter 允许的五个实现文件，外加本说明：

- `lib/providers/registry.mjs`（新增）
- `lib/providers/http-openai.mjs`（新增）
- `lib/usage/ledger.mjs`（新增）
- `test/contract/http-provider.test.mjs`（新增）
- `test/unit/http-usage.test.mjs`（新增）
- `.collab/tasks/033/impl.md`（本文件）

未修改 brief.md、design.md、acceptance.md、review*.md、verdict*.json、state.json、run.json，也未执行 git 命令。未改动配置 schema、冻结错误注册表、CLI/HTTP 路由、既有调用器、凭据模块、身份模块、probe 或测试辅助文件。

## 改了什么、为什么

### 1. `lib/providers/registry.mjs`

提供两种 transport 的库内描述符：

- `createHttpDescriptor({ provider, base_url, chat_path, supported_models, default_timeout_ms })`
  - 描述符含 `transport: "http"`、`base_url`、`chat_path`、`endpoint`、`supported_models`、`identity_hook`、`usage_hook`。
  - `buildChatEndpoint` 校验 URL 协议、禁止凭据/查询串/fragment，并把 base URL 与 chat path 拼接为唯一 endpoint。
  - `supported_models` 必须由调用方注入；lib 不保存模型白名单。
  - 描述符及 `supported_models` 均冻结。
- `createDeepSeekDescriptor({ supported_models, default_timeout_ms })`
  - 固定首个渠道为 `https://api.deepseek.com` + `/chat/completions`，拼接结果精确为 `https://api.deepseek.com/chat/completions`；模型仍由调用方注入。
- `createCliDescriptor({ provider })`
  - 含 `transport: "cli"`；`buildCall(options)` 直接调用既有 `buildDirectCall(options)`，不改变 CLI 参数、身份或执行行为。
- `identityFromResponse` / `usageFromResponse`
  - 客户端与 registry hooks 共用同一套规则，避免两套解释。
  - 身份只在非空 `response.model` 与请求模型严格相等时为 `verified`；缺失、空字符串、非法类型、不匹配均为 `observed`，缺失证据不回调请求模型，不匹配保留实际模型。
  - 用量只接受非负安全整数的 `prompt_tokens` / `completion_tokens`；任一缺失或非法则整次用量保持未知；忽略 cache 明细。
- `validateHttpRequest`
  - 校验描述符结构、endpoint、注入的支持清单、所选模型、messages、timeout_ms；全部在凭据读取和 fetch 之前以 `E_REQUEST_INVALID` 失败。

### 2. `lib/providers/http-openai.mjs`

`callHttpProvider({ descriptor, config, model, ctx, messages, timeout_ms })` 完成完整 HTTP 调用：

- 本地配置只接受 `apiKeyEnv` 环境变量名：
  - 非法名称 → `E_REQUEST_INVALID`；
  - `sk-...`、`env:...`、`vault:...` 或含控制字符的值 → `E_CONFIG_SECRET_INLINE`；
  - `apiKey`/`api_key`/`token`/`secret`/`password` 或 `config.secrets[provider]` 的明文值 → `E_CONFIG_SECRET_INLINE`。
- 在内存中构造 `{ [provider]: { ref: "env:<name>" } }` 的配置副本并调用现有 `resolveSecret`，不修改原配置、`ctx.env` 或凭据模块；不触发 keychain 回退，不增加 vault 源。
- 变量缺失/空字符串/解析为空 → `E_SECRET_BACKEND`、`retryable=false`、消息包含变量名、fetch 次数 0；其他 secret 异常归一为 `E_SECRET_BACKEND`，不输出原始异常。
- 通过 `ctx.fetch` 发送非流式 JSON POST（`stream:false`），URL 为描述符 endpoint，Authorization 只在内存请求头中；`redirect:"manual"`，不跟随重定向。
- 超时经 `ctx.clock.setTimeout` 覆盖 fetch 与响应体读取，结束后清理计时器；超时主动 abort，`settled` 标记防止迟到的计时回调重复处理响应。
- 固定重试上限为 2 次（首次 + 一次立即重试）：仅 5xx（无明确配额证据）和超时重试；认证、请求错误、配额、重定向、网络异常、解码/结构错误立即停止。耗尽后保留表中 `retryable` 值。
- 错误映射：401/403 → `E_PROVIDER_AUTH`；429/402/5xx 明确配额证据 → `E_PROVIDER_QUOTA`；5xx → `E_PROVIDER_FAILED`；超时 → `E_TIMEOUT`；其他 4xx → `E_REQUEST_INVALID`；重定向/网络/非法 JSON/缺少必需回复结构 → `E_PROVIDER_FAILED`。
- 429 `Retry-After` 支持非负秒数与 HTTP 日期，转换为 ISO；缺失/负数/无效为 `null`；429 不重试，`retryable=false`。
- 每次尝试独立提取用量并汇总；未知尝试不补零；存在已确认用量时即使最终失败也保留；合计溢出安全整数显式失败。
- 返回结果只含既有 provider-result 表达字段（`identity`、`identity_source`、`reason`、`reported_model`、`usage`、`attempts` 等），不新增结果 schema/版本/包裹层；最终结果按现有 `redact` 规则和本次秘密值整体脱敏。

### 3. `lib/usage/ledger.mjs`

`commitHttpUsage(config, { ctx, descriptor, model, result, kind, lease_id, idempotency_key })`：

- 模型键为 `<provider>:<model.id>`，同一模型经 codebuddy 与官网得到不同 model.key。
- `poolsFor` 只按 `config.pools[].capacity_mtok` 中精确的 model key 选池。
- `assertChannelIsolation` 在客户端付费请求前和账本提交前检查既有池成员：HTTP 渠道的池中若出现其他渠道键（含无前缀 CLI 键）即 `E_REQUEST_INVALID`；不会合并、拆分或改写用户的池。
- 复用 `usageFile`、`readJsonl`、`appendJsonl`、`lockFilePath`/`withLock`，行结构保持 `cliworker.usage/v1`，不新增来源字段或 schema 版本。
- 防重条件为 `(model === sourceKey, idempotency_key)`，两个来源即使原始 idempotency_key 相同也各保留一行；重放/并发只追加一次。
- 未知用量返回 `{ written:false, reason:"usage_unknown" }`，不写零账。
- 损坏账本由 `readJsonl` 显式抛错，写入异常直接抛出；均不覆盖、不截断既有字节。
- 账本提交不调用 fetch，客户端请求重试与写盘重试分离。

## 如何自测

在仓库根 `C:\git\dsh-CLIWorker\.collab\worktrees\033` 运行：

1. 验收要求的 TAP 命令：

```pwsh
node --test --test-reporter=tap test/contract/http-provider.test.mjs test/unit/http-usage.test.mjs
```

结果：23 个测试全部通过，`# fail 0`、`# cancelled 0`、`# skipped 0`、`# todo 0`，进程退出码 0。

2. 按 acceptance.md 的 pwsh 校验块执行同一组测试，输出最后一行 `AC-078 OK`，确认 TAP 摘要中 `# tests 23` 且各失败/跳过计数为 0。

3. 验收文档格式：

```pwsh
node scripts/check-acceptance.mjs .collab/tasks/033/acceptance.md
```

结果：`check-acceptance: ok (files=1 warnings=0)`，退出码 0。

4. 只读静态检查（不写文件、不调用 git）：

```pwsh
node scripts/check-unused.mjs
node scripts/check-no-model-table.mjs
```

结果分别为 `check-unused: ok (files=67)` 和 `AC-079 OK`，退出码 0。

5. 额外运行了受新增 lib 文件影响的既有测试（check-unused、check-no-model-table、import-safe、context、seams、leak-scan-canary），46 个测试全部通过。

未运行 `scripts/check-fast.ps1`；本任务按 acceptance.md 的目标命令和上述只读检查完成自测，没有执行 git，也没有生成报告或夹具。

测试覆盖：真实 registry 描述符 → 真实 `callHttpProvider` → 真实 `resolveSecret` env 源 → 真实 `commitHttpUsage` → `readJsonl` 回读；DeepSeek endpoint 精确拼接；注入模型 ID；CLI 描述符与 `buildDirectCall` 等价；身份 verified/observed 全分支；123/45 与 0/0 精确记账；缺失/负数/小数/非数字/超安全整数不写零账；cache 不重复计费；来源分池与 `evaluatePools`；跨渠道共池拒绝；重放/并发防重；损坏账本与写入失败；错误码、retryable、retry_after、fetch 次数逐项断言；超时覆盖 fetch 与响应体读取；重试用量合计；秘密不出现在结果、stdout、stderr、错误、证据或所有写入内容中。

## 明确保留的缺口

HTTP provider 的端到端 probe 接线未在本任务实现，归 T-020。本次不修改 `lib/probe.mjs`，也不宣称当前 CLI/HTTP 路由已经能够调用该渠道；本任务交付的是可直接使用的库层 HTTP 客户端、registry 描述符和来源隔离账本能力。
