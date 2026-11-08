---
write_scope:
  - lib/secrets/inline.mjs
  - lib/config.mjs
  - test/unit/inline-secret.test.mjs
  - test/integration/secret-backend-failure.test.mjs
---

# Task 034 - 配置明文拒载与凭据后端失败处理

## 目标

只负责 AC-033。依据同目录 brief.md、任务图中 T-034 的依赖与 AC-033 正文、现有 lib/config.mjs、contracts/schemas/config.v2.schema.json、contracts/registry.snapshot.json。brief 未给基准 commit SHA 或既有验收报告路径，不引用其他任务的基线。

本稿尚不能作为完整实施规格：T-034 明确 depends_on T-013，但当前工作树没有 lib/secrets/、lib/commands/auth/，lib/cli.mjs 也没有 auth 路由；.collab/tasks/013/ 只有 brief.md，没有可核对的接口设计。后端失败处理与凭据状态的真实调用入口无法确定。attention.json 已请求先交付依赖或明确调整范围；裁决前不得用测试自建的凭据实现代替生产代码，不得宣称 AC-033 通过。

配置拒载部分可以确定如下：

1. 将 lib/config.mjs 中现有 checkSecrets 递归逻辑提取到 lib/secrets/inline.mjs，由 loadConfig 直接调用；保留 loadConfig({file, ctx}) 签名、同步行为及现有校验顺序。解析或根结构错误、示例拒载、版本与必需结构校验仍按现有行为处理；扫描在迁移、克隆和返回配置之前执行，不解析或读取凭据后端。
2. 遍历原始配置的全部对象自有可枚举项及数组元素，不仅检查顶层 secrets。沿用现有敏感键匹配规则 `/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret|credential)$/i`，避免遗漏既有 apiKey、access_token、auth-token 等受保护写法。命中且值非 null/undefined、又不是合法 SecretRef 时抛出 E_CONFIG_SECRET_INLINE；保持现有对空字符串、数字、布尔、数组和普通对象的拒载行为，不缩小为只检查非空字符串。
3. SecretRef 使用现有 `{ref: ...}` 结构，ref 的字符串规则沿用 `^[a-z]+:.+$`，不新增协议白名单或 schema 字段。不能因为对象含 ref 就跳过其其他子项；如同时含 password 明文，仍须拒载。v2 顶层 secrets 的条目须遵守现有 schema 的 required/ref/additionalProperties 约定，字符串条目不能冒充引用。不得将 schema 中的 additionalProperties=false 改为宽松透传。
4. 保持无 schema、cliworker.config/v1、cliworker.config/v2 的既有加载、迁移、路径及运行时兼容视图；未命中敏感键的普通文本不按值形状猜测为秘密。null 占位沿用现有行为；合法引用原样保留，加载阶段不解引用，不修改原始文件或注入环境。
5. 使用既有 E_CONFIG_SECRET_INLINE，错误消息使用固定安全文本，不包含值、原始 JSON、敏感键路径或异常 cause。CLI 通过既有错误映射返回退出码 3、ok=false、error.code=E_CONFIG_SECRET_INLINE、retryable=false、retry_after=null；无需修改 CLI、注册表或错误 envelope。

凭据后端部分已确定的要求如下，但实现入口与接入位置须在依赖到位后补全：

1. 必须覆盖 T-013 生产后端的读取、写入失败，以及实际凭据状态入口。使用注入 ctx.exec 模拟 secret-tool、security、pwsh 不存在（ENOENT）和非零退出；不得执行系统原生 keyring，不得以当前主机平台为由跳过三个平台的模拟测试。
2. 后端不可用或拒绝读写使用既有 E_SECRET_BACKEND；注册表已规定 exit=3、http_status=500、retryable=false。经共享错误输出转换时 retry_after=null，不把 backend stderr、stdout、错误消息中的合成秘密带入输出，也不回退为明文文件。
3. 后端失败必须与凭据未设置区分：不能吞错后返回 unset，不能在失败后返回成功的 set。成功状态查询仅暴露既有 set/unset，不回传凭据值；失败走既有错误契约，不新增状态枚举或返回字段。
4. 对 state_dir 的文件名与内容做操作前后比较，失败后保持一致；使用内存文件系统并记录所有写入、追加、重命名、删除和建目录调用，防止写入后删除的短暂明文落盘漏检。不得因错误处理创建 fallback 文件或污染配置文件。
5. 不能在 inline.mjs 中凭空实现第二套凭据存储，不能仅测试 errorBody('E_SECRET_BACKEND', ...) 来冒充真实后端集成。依赖交付后应核对公开入口与错误边界：若修复需要修改四文件之外的 T-013 后端，须先明确任务归属，不能越界修改。

## 约束

实现 write_scope 严格为 front matter 的四个路径；无通配扩权。不增加依赖、schema 字段、协议版本、错误码、状态枚举、追踪文件或 CLI 路由。Node 20+ / ESM，文本 UTF-8 无 BOM。测试夹具内联在两个获准测试文件中，使用现有 test/helpers/ctx.mjs 与必要的测试内探针，不另建文件；仅使用合成秘密。

本 design 角色只创建同目录 design.md、acceptance.md，以及用户明确允许的阻塞问题 attention.json；不修改任何代码，不执行 git。没有运行 scripts/check-fast.ps1：其检查链会执行其他脚本及全量测试，可能执行 git 或生成文件，超出本角色限制；下游应在获授权的实现/验证阶段执行。当前工具实际启动 PowerShell 5.1，pwsh 不在 PATH，检查的标准 PowerShell 7 安装位置也不存在；下游检查命令仍要求 PowerShell 7，不能声称已经执行。

## 建议验收方向

acceptance.md 登记 AC-033 的独立命令与期望输出。两个目标测试文件的本任务测试名均包含 [AC-033]，分别覆盖配置递归拒载、真实后端失败与凭据状态；全部必须实际运行，不能 skip/todo。既有配置回归只读运行，不能为使验收变绿而修改范围外文件。

待 attention 裁决及依赖接口核实后，补全后端测试的生产模块路径和调用方式，再将本稿作为最终实施规格。缺失依赖、未补全真实调用入口、测试文件缺失或测试全跳过都不能作为 AC-033 通过。
