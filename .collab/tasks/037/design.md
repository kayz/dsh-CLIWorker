---
write_scope:
  - lib/discovery/rules.mjs
  - lib/discovery/scan.mjs
  - test/integration/discovery-rules.test.mjs
  - test/fixtures/discovery/**
  - lib/commands/discover.mjs
  - lib/discovery/inventory.mjs
---

# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

## 目标

依据同目录 brief.md、REQUIREMENTS.md 第 3 节、现有 discovery 实现和冻结契约。11 个 CLI 的名单已明确：codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode；`test/integration/fake-cli.test.mjs` 使用相同名单。不得用 gemini 或 cursor-wsl 替换其中成员。brief 未给基准 commit SHA 或既有验收报告路径，不另造基准。

本轮用户裁决已解决上一轮 attention.json 的问题，可以进入实现。裁决覆盖 brief 中 provider/身份档位输出、未知文件不得进入 entries 的旧措辞：沿用冻结 inventory/v1，id 表示 CLI 键，auth 表示既有身份/认证证据状态，evidence 表示观察锚点；未知文件不得进入可发现集合，但保留既有显式未知候选行为。本轮只修改 design.md、acceptance.md，不修改历史 attention.json 或任务状态。

已核对任务图的 T-037 写域新增 `lib/commands/discover.mjs`、`lib/discovery/inventory.mjs`，AC-080 文案已同步。中央 AC 索引已包含 AC-080 / T-037 / M3 / integration，baseline 为 darwin、linux、win32，不再新增分片、索引字段或版本。传入的 docs/contract.md 差异是既有中央索引摘要更新；当前索引按 CRLF 转 LF 后的 SHA-256 为 `595d5ed546c1eb3a5ef9d280776fee338fa5c63be930659d4be5903af145dabd`，与增量一致。保留该外部变更，不将文档、索引或冻结清单加入本任务写域。

## 约束

1. 严禁修改或扩展 `contracts/schemas/inventory.v1.schema.json`。条目恰好使用 `id`、`recognized`、`platform`、`path`、`realpath`、`version`、`fingerprint`、`auth`、`evidence`、`first_seen`、`last_seen`、`status`，顶层、嵌套字段及版本也沿用冻结契约；不输出 provider、identity 或新集合字段，不复用 auth.state 填入 verified/observed 等模型身份档位。
2. “可发现集合”是原始 `entries` 中同时满足 `recognized === true` 与 `status === 'present'` 的条目投影，只是验收及后续消费口径，不增加输出字段、公共接口或路由。不匹配规则、unknown_patterns 和 override 的普通未知文件不产生新 entries；显式匹配 unknown_patterns 或 override 的未知候选继续进入原始 entries，recognized=false。默认不执行未知候选，显式 `--probe-unknown` 或既有 probe_unknown 配置可以探测版本，但成功也不能变为 recognized=true。保留已有未知条目历史及 gone 语义，不因过滤可发现集合而删除它们。
3. 识别证据按以下确定边界处理。文件名命中声明规则即可 recognized=true，不以版本成功作为规则识别开关。成功的版本探针且 stdout 含现有版本正则匹配时填 version；非零退出、启动/超时失败结果或无可解析版本时为 null。每次实际探针均沿用一个 kind=probe 的证据，记录真实退出码或 null、受控时钟时间、脱敏命令及 stdout 的 SHA-256；成功空输出仍有观察证据但无版本。没有执行时 evidence=[]、version=null。版本探针不证明登录；本任务新建或重新探测的条目 auth 均为 `{ state: 'unknown', source: 'none' }`，不能凭名称、版本成功或用户环境推断 logged_in/token_ref。身份证据的强弱由 auth 的保守状态与 evidence 的有无、exit、digest 一起体现，不另建等级。返回失败结果与现有 ctx.exec 抛异常的 E_INTERNAL 语义保持区分，不吞掉内部异常。
4. 按用户裁决，`lib/discovery/rules.mjs` 本身承载 CLI 声明数据，以 REQUIREMENTS.md 第 3 节的 11 项及本设计为契约来源；不再要求新增独立 JSON 声明文件或 provider 映射。每项仅需沿用现有内部字段 name、versionArgs：name 为上述精确键，可执行基名与键一致，版本观察参数统一为 `['--version']`。这是本任务的离线探针契约，真实工具不支持或输出不同就保留失败/空版本证据，不据此宣称真实版本兼容已验证。无需新增 agent、claudecode、cursor-wsl、gemini 等名称别名。规则及参数数组冻结，保留 RULES、findRule(name, platform) 的既有使用方式；通过逐条声明、再汇集规则实现数据驱动，避免将多种 CLI/模型名称堆入同一数组/对象字面量触发现有检查器。不包含任何模型 id、能力、价格或模型身份表，不拆分/编码名称掩盖检查，不改检查器或白名单。运行时不读取 REQUIREMENTS.md、测试夹具或工作流目录，也不在 discover 命令中复制名称分支。
5. YAML write_scope 按相对仓库根路径解释，`*` 只匹配单段、`**` 匹配多段。禁止修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs`；禁止 `lib/` 中 `process.exit`，不新增第三方运行时依赖、不放宽既有断言、不执行 git。

## 建议验收方向

下游按以下顺序实施，以 acceptance.md 中的独立命令验证；此前阻塞条件已解除，不等待再次确认：

1. `lib/discovery/rules.mjs` 增补 11 项声明，claude 的 name 和 versionArgs 保持兼容。测试独立给出名单和每项预期，不从 RULES 或返回 entries 生成预期。规则只决定 CLI 识别及版本观察，不承担模型发现或认证验证。
2. `lib/discovery/scan.mjs` 保留只枚举显式目录的直接子项、realpath 去重、稳定排序、不可访问目录记录等行为；win32 去除 exe/com/cmd/bat 后缀并忽略大小写，POSIX 维持精确大小写。不能把未知文件补为已知规则，也不能对同一 realpath 重复探测。不同安装路径允许具有同一 CLI id，不给 id 追加路径或编号；单安装夹具中每个 id 恰好一项。
3. `test/fixtures/discovery/**` 保存无秘密的合成假可执行文件或其模板、响应及调用记录所需数据。测试运行时的配置、inventory 和记录在独立系统临时目录生成并 finally 清理，不污染用户目录、不启动真实厂商 CLI、不访问网络。
4. `lib/commands/discover.mjs` 仅从候选 rule 取得已知 id、recognized 和版本参数，沿用既有条目字段、证据摘要算法与认证保守值；不新增 CLI 名称判断。`lib/discovery/inventory.mjs` 保留 canReuse 和 markGone 的既有接口及语义，可与命令协作处理缓存识别状态。按当前规则核对旧条目的 id/recognized：若与当前候选识别状态不一致，不能原样复用，应重新构造并按现有策略探针；无当前规则的历史条目不得仅凭旧 recognized=true 混入可发现集合。现有证据时间决定 TTL，不能用刷新 last_seen 延长证据有效期；指纹变化、TTL 到期和 --full 仍重探针。保留 first_seen、消失条目的 gone 标记及目录读取失败时不误判消失的行为。
5. `test/integration/discovery-rules.test.mjs` 使用 Node 内置测试设施，标记既有 AC-080，实际覆盖生产 discover 路径。以仅含夹具的 PATH 测试全量 11 项、真子集和零已知 CLI；win32 垫片使用现有安全执行机制，POSIX 使用绝对 Node 解释器路径的可执行脚本，均由 process.execPath 确定运行位置，不追加用户 PATH。至少一组通过真实 bin 子进程运行，并检查 stdout 单个 JSON 与落盘 inventory；进程内受控上下文用于时钟、读取失败和缓存反例。禁止以替身返回完整 inventory 绕过生产发现逻辑。
6. 每条记录均按冻结 schema 校验，逐项核对 id、recognized、auth、路径、指纹、version、status 及证据全部字段；摘要由夹具预设 stdout 独立计算。覆盖成功版本、成功但无版本文本、非零退出及无可用退出码的失败结果；auth 始终不得因版本观察而升级。全量夹具中的可发现集合恰好等于 11 项，子集等于输入已知项，零已知时为空。
7. 负例同时覆盖普通未知文件被忽略、pattern/override 未知候选仅留在原始 inventory、默认零执行和显式未知探针仍 recognized=false；覆盖历史未知候选和过时缓存识别状态。重复 PATH、realpath 别名只执行一次；反转枚举顺序不改变排序与键；保持缓存 TTL、first_seen 和 gone 的回归断言。不要求不同时间的整个 inventory 字节相等。
8. 保留原有 discovery 集成测试和单元测试，不修改其断言；执行模型表静态检查、AC-080 筛选运行及项目 check-fast。不得为接线扩写 test/traceability、中央索引或其他范围外文件；当前 AC-080 已注册，测试标记沿用现有 runner 机制。

## 非目标

不实现真实版本协商、WSL 内发现、真实认证或真实模型调用，不因假 CLI 返回版本就授予模型身份验证。不得修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码文件来完成本轮设计。

## 验收格式

acceptance.md 的每项命令独立判定退出码和 stdout，成功才打印对应 AC 哨兵。不根据测试标题、函数名或行号判定成功。AC-080 同时要求声明规则全覆盖、冻结字段严格有效、auth/evidence 强度保守、未知候选不进入可发现集合及既有行为兼容。没有 provider/identity 输出不是缺项，而是本轮明确裁决的契约边界。

本轮仅运行不生成额外文件、不执行 git 的验收格式自检及文本检查。全量 check-fast 会运行测试及产生报告，留给下游实施完成后的验收阶段。本机工具实际返回 Windows PowerShell 5.1，且未找到 pwsh；不将其冒充 PowerShell 7 的执行结果。验收块要求由具备 PowerShell 7 的 runner 作为独立 .ps1 执行，本轮不创建 .ps1 文件。
