---
write_scope:
  - lib/discovery/rules.mjs
  - lib/discovery/scan.mjs
  - test/integration/discovery-rules.test.mjs
  - test/fixtures/discovery/**
---

# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

## 目标

依据同目录 brief.md、REQUIREMENTS.md 第 3 节、现有 discovery 实现和冻结契约。11 个 CLI 的名单已明确：codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode；`test/integration/fake-cli.test.mjs` 使用相同名单。不得用 gemini 或 cursor-wsl 替换其中成员。brief 未给基准 commit SHA 或既有验收报告路径，不另造基准。

本设计存在必须先裁决的契约冲突，已按任务指令提交同目录 attention.json。当前不得进入实现，也不得将下列待定内容视为默认获准。front matter 仅声明 brief 原有的下游实现写域，不扩大授权；本轮只写 design.md、acceptance.md，以及任务明确允许的 attention.json。

## 约束

1. `contracts/schemas/inventory.v1.schema.json` 中 inventory 条目只允许既有的 `id`、`recognized`、`platform`、`path`、`realpath`、`version`、`fingerprint`、`auth`、`evidence`、`first_seen`、`last_seen`、`status`，并设置 `additionalProperties: false`。没有 provider 或 identity 字段。`lib/commands/discover.mjs` 的条目构造也没有输出这些内容。brief 要求的“键”可以对应现有 `id`；provider 和身份档位没有可直接沿用的 inventory 契约位置，不能自行增加字段、版本或把它们塞入证据文本代替字段。
2. 本次允许修改的 `rules.mjs` 与 `scan.mjs` 无法更改 `lib/commands/discover.mjs` 的条目构造。即使在规则或候选上增加元数据，discover 也不会将其输出。若保留完整目标，必须先明确输出字段、身份档位及证据强度判定，并明确授权必要的命令实现、schema 和兼容测试路径；不能仅扩 front matter 后自行实施。
3. 现有 `scanLocal` 接受匹配 `discovery.unknown_patterns` 的未知文件及显式 override。`test/unit/discovery/scan.test.mjs`、`test/integration/discovery.test.mjs` 要求保留其候选；`test/integration/discover-command.test.mjs` 进一步要求 `other-cli` 进入 entries、`recognized: false`，默认不执行，显式 `--probe-unknown` 后可以执行。brief 的“未识别的可执行文件不得进入 entries”若为无条件要求，就与这些既有断言冲突；本次又禁止放宽断言且没有这些测试及命令实现的写权。不能通过移除 unknown_patterns、忽略 override、伪装 recognized、按测试环境分支或保留旧缓存条目来绕过。
4. 11 个名称不等于 11 份识别契约。`lib/discovery/rules.mjs` 当前只有从 inventory 示例建立的 claude / `--version`；`config/cliworker.example.json` 仅声明部分 provider，且包含不属于本次名单的 CLI。REQUIREMENTS.md 和 fake-cli 名单没有给出其余各项的 provider 映射、可执行名称别名、版本探针及身份判据。需要指定完整的配置/契约数据来源，或授权补齐生产声明的位置和内容；不得从测试夹具加载生产规则，不得把 11 个名称嵌入模型表，也不得假定所有 CLI 都支持同一真实参数或将版本成功等同于模型身份 verified。
5. YAML write_scope 按相对仓库根路径解释，`*` 只匹配单段、`**` 匹配多段。禁止修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs`；禁止 `lib/` 中 `process.exit`，不新增第三方运行时依赖、不放宽既有断言、不执行 git。

## 建议验收方向

裁决到达后先同步本设计与 acceptance.md，再启动实现。若保留完整目标，裁决必须同时解决输出契约、11 项规则数据来源及未知 CLI 的兼容边界，并给出所需新增写域；若收窄目标，必须明确取消或调整 brief 中哪些要求，不能由下游擅自解释为已取消。

已经确定、可沿用的实现顺序和验收边界如下；它们不替代上述前提：

1. `lib/discovery/rules.mjs` 从获准的配置/契约声明生成规则，保留现有 `RULES`、`findRule(name, platform)` 使用方式及 claude 的兼容行为。11 项预期名单由测试独立给定，不能从被测返回值反推预期。规则数据不得包含硬编码模型清单。
2. `lib/discovery/scan.mjs` 保留只枚举显式目录的直接子项、realpath 去重、稳定排序、不可访问目录记录等行为；win32 名称归一和 POSIX 大小写语义沿用现有实现。未知候选过滤必须按明确裁决实施，不能破坏既有测试以换取 AC-080 通过。
3. `test/fixtures/discovery/**` 保存无秘密的合成假可执行文件或其模板、响应及调用记录所需数据。测试运行时的配置、inventory 和记录在独立系统临时目录生成并 finally 清理，不污染用户目录、不启动真实厂商 CLI、不访问网络。
4. `test/integration/discovery-rules.test.mjs` 使用 Node 内置测试设施，标记既有 AC-080，实际覆盖生产 discover 路径。以仅含夹具的 PATH 测试全量 11 项和至少一个真子集；win32 垫片使用现有安全执行机制，不能裸 spawn 批处理后将启动失败当作识别失败。Node 运行位置由 `process.execPath` 提供，不靠把用户 PATH 追加回夹具 PATH 才能启动。禁止以测试替身返回完整 inventory 绕过生产发现逻辑。
5. 逐项检查现有 `id` 的准确值、唯一性、recognized、版本及 `evidence` 的 kind/cmd_redacted/exit/at/digest，摘要由假进程实际 stdout 独立计算；版本失败不能伪造版本。重复发现或改变目录枚举顺序后，键与证据含义稳定，时间类字段按受控时钟检查。provider 和身份档位的具体断言必须等待契约裁决，不能以 recognized 或 auth.state 冒充身份档位。
6. 未识别文件应按最终裁决检查 entries 中是否存在及执行记录；全量、子集与负例都不得空转。另保留原有 discovery 集成测试、既有单元测试、模型表静态检查和项目 check-fast 门禁。

## 非目标

不实现真实版本协商、WSL 内发现、真实认证或真实模型调用，不因假 CLI 返回版本就授予模型身份验证。不得修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码文件来完成本轮设计。

## 验收格式

acceptance.md 的每项命令独立判定退出码和 stdout，成功才打印对应 AC 哨兵。不根据测试标题、函数名或行号判定成功。当前文档列出确定的命令入口与预期结果，但 AC-080 的完整字段和未知 CLI 判据尚未获裁决，不能据此宣告需求已完成；必须先解决 attention.json 并同步两份规格。

本轮仅运行不生成额外文件、不执行 git 的验收格式自检及文本检查。全量 check-fast 会运行测试及产生报告，留给下游实施完成后的验收阶段。本机工具实际返回 Windows PowerShell 5.1，且未找到 pwsh；不将其冒充 PowerShell 7 的执行结果。验收块要求由具备 PowerShell 7 的 runner 作为独立 .ps1 执行，本轮不创建 .ps1 文件。
