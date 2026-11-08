---
write_scope:
  - lib/secrets/inline.mjs
  - lib/config.mjs
  - test/unit/inline-secret.test.mjs
  - test/integration/secret-backend-failure.test.mjs
---

# Task 034 - 配置明文拒载与凭据后端失败处理

## 目标

只负责 brief.md 指定的 AC-033：递归拒载配置内联明文、凭据后端失败、凭据状态可判定，同时保持既有配置兼容。

本轮用户已裁决：暂停 T-034，直到 T-013 合并；四文件 write_scope 不变；不得编造接口或建立仅供测试的后端。T-013 合并后，依据其真实公开 API（lib/secrets、lib/commands/auth、auth 路由）恢复设计。此裁决替代上一稿“等待 attention 裁决”的描述，无须再次提问，也不创建 attention.json。

当前检查仍未发现 lib/secrets/、lib/commands/auth/，lib/cli.mjs 也未提供 auth 路由；.collab/tasks/013/brief.md 只描述交付要求，不能代替已合并实现。本稿记录暂停条件与恢复步骤，不授权启动实现，不表示 AC-033 已通过。暂停期间不推进配置部分的独立实现。

依据为本任务 brief.md、本轮用户裁决、.collab/tasks/013/brief.md、.collab/blueprint/cliworker-v2/task-graph.json 中 AC-033、现有配置与错误契约。brief 未给基准 commit SHA 或既有验收报告路径，不自行指定基线。

## 约束

下游实现只能修改 front matter 的四个文件，不扩大为目录通配符；测试夹具和必要探针放在获准测试文件内。不新增 schema 字段、版本、错误码、状态值或公开接口，不修改 CLI 路由、T-013 后端、契约、测试辅助文件或追踪分片。不依赖操作系统原生 keyring，不访问真实凭据；保持 Node 20+ / ESM、零第三方运行时依赖、UTF-8 无 BOM。

恢复后的执行顺序：

1. 先取得调度器或人类对 T-013 已合并的确认，并确认本任务工作树已包含该实现。仅有目录、接口草案或另一个未合并工作树不满足恢复条件；本角色不执行 git。没有合并确认时继续暂停，不运行依赖缺失的测试来充当验收。
2. 读取合并后的 lib/secrets、lib/commands/auth、auth 路由、配置加载逻辑及相关测试，在本文件现有章节内补全真实模块路径、公开导出、参数、返回值、异常边界和调用链。只引用实际存在的接口，不预先命名导出或假定依赖注入签名。
3. 对照四文件范围核实可实施性。如果后端错误归一化、状态查询或路由接入必须修改范围外文件，保持暂停并将具体路径与缺口交调度器处理，不扩权、不在 inline.mjs 建立第二套凭据实现，也不用测试实现替代生产后端。
4. 在依赖实现核实后确定 inline.mjs 与 loadConfig 的接入方式。递归扫描对象和数组；敏感键匹配、合法 SecretRef 及空值等边界以合并后的配置行为和既有契约为准。保留既有无 schema、v1、v2 配置、迁移、路径解析及示例拒载行为，不因本任务收窄已有明文检测能力。上一稿推定的导出、调用签名及尚未核实的后端细节不作为实施规格。
5. 同步补全 acceptance.md，使两个目标测试文件通过真实生产调用链覆盖以下既有要求后，才交给实现角色：配置中 token、api_key、secret、password 等既有敏感键（不区分大小写）的内联明文返回 E_CONFIG_SECRET_INLINE；合法 SecretRef 与非敏感普通文本可加载；注入 exec 模拟 secret-tool、security、pwsh 的 ENOENT 时，对应真实后端返回 E_SECRET_BACKEND，state_dir 文件列表不变；真实 auth status 成功时只暴露既有 set/unset 状态，不泄露凭据。失败不得冒充未设置或成功，不得回退为明文文件。三个平台的模拟均须执行，不能按主机平台跳过；原生后端测试不作为本任务通过的前提。

错误码及 CLI 退出码沿用 contracts/registry.snapshot.json 与共享错误输出：E_CONFIG_SECRET_INLINE 和 E_SECRET_BACKEND 的退出码均为 3、retryable 均为 false。凭据值不得出现在错误、日志或 JSON 输出。测试只注入合成数据与外部依赖故障，不能仅验证错误构造器而绕过生产调用链。

本 design 角色只修改同目录 design.md、acceptance.md；不修改代码或任务状态，不创建其他文件，不执行 git。当前未运行 scripts/check-fast.ps1：它会调用其他检查与全量测试，可能执行 git 或创建文件，超出本角色明确限制；该检查保留给下游获授权阶段。当前也未运行目标测试，不记录通过结果。

## 建议验收方向

acceptance.md 保留 brief 指定的总验收命令及独立单元、集成、配置回归和项目检查命令。所有命令均为 T-013 合并、真实 API 核实、设计补全及实现完成后的验收要求，不能用来解除合并门槛。

恢复设计时必须将行为断言落实到真实生产入口；测试文件缺失、零用例、跳过、todo、仅测试错误构造器或使用测试自建后端均不能证明 AC-033 通过。T-013 合并前，本任务保持暂停。
