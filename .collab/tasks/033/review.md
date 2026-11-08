# Task 033 评审

结论：pass（1/1，AC-078）。评审 SHA：97d6f884bfb8d6c5799367b9862253bc9a700ccb（task/033 HEAD，只读自 worktree 的 HEAD 与 refs，未执行 git）。

## 证据口径

- 执行类证据：`.collab/tasks/033/ci-results.json`（passed=1 total=1 ok=true，exitCode=0，lastLine=`AC-078 OK`）。TAP 摘要：tests 23、pass 23、fail/cancelled/skipped/todo 均为 0，23 个用例标题全部带 `[AC-078]`。
- CI 与代码不矛盾：HEAD 提交时间 1794156448（2026-11-08T16:47:28Z），CI ranAt 2026-11-09T00:47:29+08:00（16:47:29Z），晚 1 秒，reflog 末条即该提交。
- 未执行 `scripts/check-fast.ps1`，未自行重跑测试；以下为只读静态核对。

## 逐项核对（acceptance.md AC-078）

| 项 | 结论 | 依据 |
|---|---|---|
| 格式检查命令 | 通过 | ci-results.json 的 AC-078 项按功能命令整体通过；impl.md:89 记录 `check-acceptance: ok`。 |
| 功能命令（TAP 摘要） | 通过 | ci-results.json 输出 `# tests 23 … # fail 0 # cancelled 0 # skipped 0 # todo 0`，末行 `AC-078 OK`。 |
| 描述符契约 | 通过 | registry.mjs:108-141 描述符含 transport:"http"、base_url、chat_path、endpoint、冻结的 supported_models、identity_hook、usage_hook；:147-155 DeepSeek endpoint 经 :32-52 拼接为 `https://api.deepseek.com/chat/completions`；模型清单只来自注入（无硬编码表）；:176-199 未支持模型 E_REQUEST_INVALID，发生在 http-openai.mjs:311 的凭据读取和 fetch 之前；CLI 描述符 :161-170 transport:"cli"，buildCall 直通 buildDirectCall（测试 contract:294 deepEqual）；registry 无 env/网络/进程访问。 |
| 非流式 POST / 无 exec | 通过 | http-openai.mjs:203-212 `method:'POST'`、body `{model,messages,stream:false}`、`redirect:'manual'`；全文无 ctx.exec；测试 contract:306-366 断言 exec.calls 为 0、body 与 messages 相等。 |
| 凭据引用 | 通过 | :70-84 只接受 apiKeyEnv，`sk-/env:/vault:`、控制字符和明文字段 → E_CONFIG_SECRET_INLINE，非法名 → E_REQUEST_INVALID；:86-104 内存构造 `{ref:'env:NAME'}` 副本交给 resolveSecret，不改原配置和 ctx.env（测试 contract:341-342 deepEqual）；缺失/空 → E_SECRET_BACKEND，消息含变量名；其他异常归一为固定消息；Authorization 仅在 :207 的内存头；:66-68 最终结果经 redact + 本次秘密脱敏；contract:368-386 覆盖响应与异常回显秘密。 |
| 身份 | 通过 | registry.mjs:59-82：非空且严格相等 → verified/response.model；缺失、空、非字符串、不匹配 → observed/response.model，reason 非空；缺失 reported_model=null 不回填，不匹配保留实际值；客户端 :247 与 hook 同一函数；测试 contract:546-571 五个分支并与 hook 逐字段比较；未创建 lib/identity.mjs。 |
| 用量精确记账 | 通过 | registry.mjs:84-102 仅非负安全整数，任一缺失/非法整体 unknown，显式 0/0 有效，忽略 cache 明细；ledger.mjs:99-105、:123-124 未知不写零账；:138-139 cache 计数固定为 0；contract:573-615 与 unit 文件覆盖 123/45、0/0、缺失、负数、小数、字符串、超安全整数、cache。observed 身份仍记入请求渠道（contract:617-634，ledger 不读取 reported_model）。 |
| 分池 | 通过 | ledger.mjs:47-60 模型键为 `<provider>:<id>`；:63-72 poolsFor 精确匹配；:78-97 assertChannelIsolation 拒绝混渠道池，http-openai.mjs:313 在 fetch 前调用，ledger.mjs:122 在提交前再查；contract:636-738 用真实 evaluatePools 验证两池互不影响，共池时 fetch 为 0。 |
| 防重与存储失败 | 通过 | ledger.mjs:150-156 在 withLock 内按 `(model===sourceKey, idempotency_key)` 判重；跨来源同键各保留一行；并发提交只有一行；损坏账本由 readJsonl 抛 SyntaxError 且字节不变；appendFileSync 失败抛出且字节不变；账本不接触 fetch（contract:740-788）。 |
| 重试用量回归 | 通过 | http-openai.mjs:340-346 每次尝试分别累加已确认用量，未知不补零；超时首轮 + 成功仅记 123/45（contract:470-505）；两次超时 usage 未知，ledger 返回 usage_unknown 且无行（:524-530）；5xx 带用量后成功合计 133/50、最终失败合计 30/15 并入账（:790-816）；:341-345 合计溢出显式失败。 |
| 错误映射表 | 通过 | http-openai.mjs:173-188、:276-290、:328-366 与 design.md 表一一对应；contract:422-468 逐行断言码、retryable、retry_after、fetch 次数：401/403/429（秒、HTTP 日期、缺失、无效、负数）/402/配额证据/500、503 后成功与连续失败/5xx 后 401、403、429/其他 4xx/重定向/网络/非法 JSON/缺回复结构；断言不出现 E_SECRET_MISSING、E_AUTH、E_INTERNAL。 |
| 超时 | 通过 | :194-225 经 ctx.clock.setTimeout，finally 清理，abort 传入 fetch；contract:470-544 覆盖 fetch 挂起、响应体读取挂起、连续超时，并断言 `clock.pending()===0`；真实 context.mjs:58-62 提供 setTimeout/clearTimeout。 |
| 写域 | 通过（只读推断） | 文件清单：lib/providers/ 仅新增 registry.mjs、http-openai.mjs（call.mjs 为既有文件），另有 lib/usage/ledger.mjs 与两份测试；impl.md 声明未改其他文件；无法执行 git，未做 tree 比对（工具约束）。ci-results 中 check-no-model-table 等已在 impl.md 报告通过。 |

## 非阻塞观察（P2，不影响 pass）

1. 合计溢出安全整数的显式失败分支（http-openai.mjs:341-345）没有对应测试，仅靠代码阅读确认。
2. parseRetryAfter 的 HTTP 日期分支使用 `Date.parse`，对非标准字符串较宽松；现有测试仅覆盖 `soon` 和 `-5`。
3. impl.md 声明的写域符合规格，但本评审无法用 git 对 tree 做独立比对，属环境约束，不作为扣分项。

## 保留缺口

HTTP provider 的 probe 端到端接线归 T-020（impl.md:106-108 已按 design 要求记录），不构成 T-033 失败。

brief 未指定验收报告路径，故无历史文档需追加。
