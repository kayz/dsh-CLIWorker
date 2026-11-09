---
write_scope:
  - lib/http/issues-api.mjs
  - lib/http/snapshot.mjs
  - test/integration/issues-from-probe.test.mjs
  - ui/app.mjs
  - ui/render.mjs
  - test/fixtures/ui/**
  - test/integration/ui-snapshot.test.mjs
  - lib/discovery/rules.mjs
  - lib/index.js
---

# Task 043 — AC-077 问题优先页接真实 CLI 问题源

## 目标

将 probe/discover 已持久化的实际观察投影为问题，并让问题首标签页展示 API 返回的同一批记录。无观察证据不能生成问题；成功观察不能生成失败问题。只接数据，不重做视觉。

本轮用户七项裁决替代上一轮的接口、版本及凭据待定内容：snapshot 仅新增 issues；每项严格为 id、kind、subject、detail、evidence_ref、at 六字段；版本比较只采用规则显式声明的 minVersion；凭据缺失只采用已配置引用的实际缺失结果。新增写域为 `test/integration/ui-snapshot.test.mjs` 与 `lib/discovery/rules.mjs`。

本轮已授权 `lib/index.js` 的唯一变更：在 snapshotFailure 存在且 readSnapshot 抛错时直接返回的 unknown 快照对象中，增加字面量 `issues: []`。原 models、forecast、source、at、last_error 五项及所有其他逻辑保持不变；快照读取失败不是某个 CLI 的问题，该数组不得填入错误详情。此前 attention 的范围阻塞已解除，历史 attention 文件不构成再次暂停的理由，设计轮不修改该文件。

T-042 的 `.collab/tasks/042/state.json` 当前为 merged，记录的合并提交为 `b5a39615fbec2900df573807b62c7bf545c9c253`。工作区已有 `lib/discovery/probe.mjs` 和 `test/integration/discovery-probe.test.mjs`，`lib/probe.mjs` 已保存版本失败的实际证据。本轮不是因依赖未合并阻塞。brief 未指定基准 commit SHA 或既有验收报告；上述 SHA 仅为依赖来源记录，不自行设为本任务比较基准。`.collab/tasks/042/impl.md` 和 `ci-results.json` 是历史交接及结果，不能代替本任务重跑验收。

## 约束

1. 顶部 write_scope 为 brief 加续接裁决明确授权的三个文件；路径相对仓库根，`*` 匹配单段、`**` 匹配多段。设计轮只修改本文件、acceptance.md，不执行 git，不创建脚本、日志或其他文件，不修改代码或其他角色产物。用户所附 a6b4a51 增量已通过直接读取当前 availability.mjs、discovery/probe.mjs 核对，不执行 git show，也不把它设为本任务验收基准。
2. 开发仍不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`。`lib/index.js` 虽列入 write_scope，授权仅限上述 fallback 对象添加一个字面量 `issues: []`，不重构、不改控制流、不改其他对象或五个原字段，不将快照故障转换为 per-CLI 问题。其他路由、schema、配置、索引、通用 helper、旧 unit 测试与 secrets 实现均保持范围外。
3. `GET /cliworker/api/snapshot` 保留 models、forecast、source、at、last_error 的原有名称、类型、值语义及错误处理，仅新增一个顶层 issues。issues 永远是数组，无条目为 []，不得省略、null 或嵌入其他字段。所有正常、历史保留、stale 与 unknown 快照均遵守该要求；通用错误 envelope 不伪装成快照。不得通过非枚举属性、toJSON 特判或测试专用响应绕过精确字段检查。
4. issues 每项严格只有 `{id: string, kind: "unavailable"|"version-mismatch"|"missing-credential", subject: string, detail: string, evidence_ref: string, at: ISO string}`。subject 为实际 CLI key，不是任务号或虚构角色；detail 为安全可读事实。evidence_ref 指向实际 probe/discover 记录，不含绝对路径或秘密，不承诺该指针是可点击 URL。不新增 schema、版本号、配置项、计数字段或其他问题字段。
5. minVersion 只属于 `lib/discovery/rules.mjs` 的 CLI 规则，不进入 inventory/model/config schema。无声明时绝不产生 version-mismatch。不得凭空设定厂商最低版本；本轮未给任何生产最低版本值，未有依据的规则保持未声明。测试可以提供显式 minVersion 的隔离规则夹具，但不得因此为生产规则加入猜测值。
6. 沿用 15 秒 JSON 轮询，不引入 SSE、新 endpoint 或额外轮询调度。GET 不执行 CLI 探测、不访问网络、不写业务状态；凭据存在性检查按本轮授权只使用现有 resolveSecret seam，必要的本机 secrets 后端读取不等于 CLI 探测。不得扫描个人目录、读取任意日志或将 `.collab` / UI fixture 用作生产问题来源。
7. 不放宽、删除或跳过旧断言。授权修改 ui-snapshot.test.mjs 仅用于扩展 issues 覆盖：旧五字段及各字段内容的检查继续成立，新增单独的 issues 检查和完整六键精确检查。原来精确五键检查针对新增 issues 之外的其余字段执行，不能退化为只检查键数量或部分包含。其余鉴权、模型数据、脱敏、来源、轮询与失败保留检查不改语义。
8. 旧 `projectIssues(previous, records, filters)` 与旧记录渲染仍须通过 unit 测试；它们的 task_id/role/count/unclosed 不是新 issues 的接口字段。新六字段数据单独投影和渲染，不能通过给生产条目添加旧字段取得兼容。旧 issues.json 保持组件 fixture 用途，不进入生产。

## 建议验收方向

已确定的实施规格如下；本轮仅补充已授权的 unknown 兜底变更及最终交付检查，其他七项裁决继续有效。

1. snapshot.mjs 严格读取 probes.json 和 inventory.json，issues-api.mjs 投影六字段问题。复用 readProbeModels 和已有 inventory 校验能力，不把配置补出的 unknown 模型或文件存在本身当作探测失败。每条问题须可回指实际记录；无可引用记录时不造问题。probe 指针以记录的模型 key/probe_id 定位，discover 指针以 CLI、平台及观察标识定位；使用不含本机路径的状态内相对指针。id 根据 kind、subject 和证据身份确定，重复 GET 稳定，不含轮询时间。at 为证据的 ISO 时间；凭据存在性为本轮 seam 的实际观察，可用本轮 ctx.clock 时间，但不能据此伪称探测记录刚刷新。
2. unavailable：只投影实际 probe 的不可调用结果，或确有失败执行证据的 discover 观察。T-042 的 unverified 且 reason 为 `command missing`、`non-zero exit`、`unparsable output` 时仅可生成 unavailable，detail 保留相应真实原因。真实 timeout/unavailable、认证拒绝等不可调用结果可描述为不可用，但 auth 失败本身绝不生成 missing-credential。仅 state=unverified、无失败原因、仅 version=null、仅 auth=unknown 或配置里存在模型均不足以生成条目。discover 的 null version 无法单独区分缺命令与无法解析，不能从摘要还原不存在的原因；需要精确原因时以 probe 保存的 reason 为准。
3. version-mismatch：实际 discover probe evidence 支持的有效 observed semver，关联同一 CLI 的规则显式有效 minVersion，且 observed 严格低于 minVersion 才生成。按语义化版本优先级比较 major/minor/patch 及 prerelease，忽略 build metadata，禁止字符串字典序；相等、较高、规则无 minVersion、版本缺失或无法解析均不产生此类问题。detail 必须同时明确标出 observed 与 minVersion 的实际值，evidence_ref 必须定位观察记录；两字段合起来同时支持本轮要求的版本证据。最低值不能从另一 CLI 或模型价格/等级推导。非法规则声明属于规则错误，不能当作已发生版本不符。
4. missing-credential：存在可引用的 probe/discover 模型或 CLI 记录，模型有 provider，并且 `Object.hasOwn(config.secrets, provider)` 明确配置了引用时，才调用现有 resolveSecret(ctx, config, provider)。仅 seam 正常返回 null/空值表示所引用秘密确实缺失时生成；没有任何 secret 配置时不调用默认 keychain 回退，也不生成问题。secret 已存在、仅认证失败、provider 缺失均不生成此类。后端抛 E_SECRET_BACKEND 或配置无效不是秘密缺失，保持既有读取失败/stale 语义；不能吞为 null。每轮同 provider 最多解析一次，值不缓存到问题对象、不写日志、不出现在 detail/evidence_ref/id；不得复制 ref 中的环境变量名、keychain 条目名或秘密值到公开响应。
5. 同一证据同 kind/subject 去重，不增加 count 字段；同 CLI 的多个模型不得重复列出同一凭据事实，不同 CLI 不误合并。不同种类的独立事实可以共存。每次成功读取基于当前证据重建，修复后对应问题消失；读取失败保留真实旧视图并标 stale，不将坏缓存报告为一次成功的 []。缺文件且没有可引用证据的正常读取返回 issues: []。不引入生产问题历史库。
6. app.mjs 只消费 snapshot.issues，沿用 session → snapshot 与 15s 调度，调用 render.mjs 的六字段渲染分支；旧显式记录渲染分支保留供既有组件使用。无 issues 时明确展示“暂无有证据的问题”，不能伪造文章；失败时保留上次条目及 stale 提示。无 probe 来源时仍如实提示“问题来源未接入”，同时展示空状态，以保持旧无证据场景的来源断言；有探测证据时明确已接入，不把空列表当作健康保证。ui/index.html 不在写域，静态加载外壳保持原样，app 在现有容器内更新内容。
7. 所有字符串选取安全事实后脱敏并转义；reason 不能直接复用现有只接收无空格 identifier 的过滤器而丢失 `command missing` 等合法原因。禁止把原始 stdout/stderr、用户名、秘密、本机绝对路径拷贝进新字段。evidence_ref 按文本展示，不发明证据 HTTP 服务或 file URL；旧渲染的同源链接限制继续成立。
8. 新 integration 使用 AC-086、本地夹具、受控 ctx/clock、host-stub、真实 createPlugin/session/snapshot 和实际 startApp。至少一组生产 discover/models probe 写出证据，再读取 API 与 DOM，不允许 deps.handlers 预制问题取代生产链路。minVersion 测试可在隔离进程以授权 fixture 提供规则声明；测试专用规则不能写回生产文件或扩成用户配置/HTTP 参数。模块内投影逻辑接受规则输入也可作为比较边界补充测试，但不能代替真实入口覆盖。运行状态位于系统临时目录并 finally 清理。
9. 在 index.js 指定的 snapshotFailure fallback 对象中仅加入字面量 `issues: []`，不在其他分支补错误条目或改写原五项。扩展 ui-snapshot.test.mjs 的新 issues 覆盖，验证正常响应、保留旧快照响应和无历史且读缓存失败的 unknown 响应均含数组；fallback 必须恰为 []。该分支原有 source='unknown'、last_error='E_CONFIG' 等断言原样保留并通过，只附加 issues 断言。不得吞掉坏 usage/probe 缓存或改变控制流来绕开该分支。原字段精确检查与全 unit 回归要求继续有效。
10. 下游完成实现后，先通过实际 issues 与 UI snapshot 集成，再依用户指定顺序运行 `node --test "test/unit/*.test.mjs"`、`node scripts/run-tests.mjs --ac AC-086`、`node scripts/check-fast.mjs`、`node scripts/check-traceability.mjs`。每条命令独立检查退出码，结果要求见 acceptance.md；失败不能通过改范围外索引、追踪分片、检查器或跳过旧测试消除。全部通过后，下游按用户授权提交到 task/043，提交只包含本任务获准变更，lib/index.js 的差异必须仅是那个数组字面量。本 design 角色不执行实现、产生报告的检查或 git 提交，不把下游待办报告为已完成。

## 非目标

不重做视觉，不做 SSE、用户版本要求配置、认证协议、真实网络探测、问题持久文件、自动任务发现、跨重启历史、解决按钮或证据 HTTP 服务。不把规则 minVersion 扩展为生产探测命令或新 availability 状态；不宣称完成完整 CLI 任务自报与自动闭环能力。当前 availability 增量保持已知 CLI 仅版本成功仍 unverified、未知包装器兼容行为，不为此修改范围外代码或旧断言。

## 验收格式

仅使用 brief 指定的 AC-086 二级标题，将依赖、集成、回归、指定最终检查和格式自检放在同一小节；每条命令成功后才输出 `AC-086 OK`。七项裁决和 index.js 窄授权均已纳入，当前没有待决设计阻塞。局部通过不代表完整功能通过。

本设计轮仅运行无落盘的 acceptance 格式检查及 UTF-8/front matter 核对。全量检查会运行测试、生成报告或间接调用 git，与本 design 角色仅改两份文档的限制冲突，留给下游实施验收阶段执行。`scripts/check-fast.ps1` 是 check-fast.mjs 的转发包装，本次采用用户明确指定的 `node scripts/check-fast.mjs`，不重复运行等价包装。各项结果必须如实记录，本设计不豁免回归失败，也不将未执行检查写为通过。
