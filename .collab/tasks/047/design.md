---
write_scope:
  - ui/render.mjs
  - ui/app.mjs
  - lib/http/snapshot.mjs
  - test/integration/ui-config-guide.test.mjs
  - test/fixtures/ui/**
  - test/integration/ui-snapshot.test.mjs
  - test/integration/issues-from-probe.test.mjs
---

# Task 047 — 配置引导：没有可用 CLI 时也能在界面里完成配置

## 目标

按 brief 与本轮用户裁决，在已有快照和页面上提供只读配置引导。无 CLI、无模型、或全部模型不可调用时，用户仍能看到配置文件位置、provider 的 CLI 声明、修复说明与 JSON 示例。用户在显示的配置文件中修改配置，再使用现有刷新、探测操作验证；本任务不增加在线保存配置的接口。

本轮裁决已解除原 attention.json 中的阻塞，不修改该历史文件。提供的 00ac738 是上游增量线索，不是本任务验收基准；直接核对现有文件，不执行 git。当前 ac-index 已有 AC-090、owner T-047、milestone M5、integration 和 darwin/linux/win32 baseline，不再修改索引、manifest、契约文档或追踪脚本。brief 未指定基准 commit SHA 或既有验收报告。

1. 快照增加 config 摘要。

在 lib/http/snapshot.mjs 的 readSnapshot 中，复用已读取并校验的 probes、inventory 及已加载配置，构造白名单对象。正常快照顶层精确为 at、config、forecast、issues、last_error、models、source 七键。原五字段 at、forecast、last_error、models、source 及 issues 的值和语义保持；不改 availability、forecast 或问题的证据投影。

| 字段 | 可观察约定 |
| --- | --- |
| config.path | 已有 loadConfig 注入的 config._file，即实际配置文件绝对路径；不把 config._home 或 state_dir 当作配置文件。 |
| config.providers | 数组，按配置中的 provider 映射生成；来源是 discovery.cli_overrides（config.providers 为其既有兼容视图），每个 provider 一行，稳定排序。空映射返回 []。 |
| config.providers[].name | 已声明 provider 的安全名称字符串，不从秘密、环境变量或命令输出提取名称。 |
| config.providers[].cli | 已声明 cli 的安全展示字符串；对象声明取 cli，兼容既有字符串声明。普通命令名保持可读；带目录的声明只保留安全文件名，不能回传其真实目录、相对目录、UNC、盘符或其他绝对路径。缺失/不能安全展示时使用既有 unknown 展示约定，不抛错阻断页面。 |
| config.providers[].resolved | 布尔值，仅表达已有 discovery/probe 证据是否支持该目标已解析，不能据此升级模型为 callable。无匹配的有效证据时为 false。 |
| config.hint | 非空字符串，内容为可 JSON.parse 的 provider 到 cli 映射配置片段；不序列化原始配置。只使用安全 provider 名与普通命令名示例，不含实际绝对 CLI 路径、环境值或秘密引用。 |

config 自身精确只有 path、providers、hint 三键；provider 项精确只有 name、cli、resolved 三键。不添加 schema、版本、状态枚举、时间戳、错误字段、raw、env、secrets 或新路由。

resolved 在原始目标上匹配证据，匹配之后才做展示脱敏，不能用被截断的文件名把不同绝对路径误配。绝对 CLI 声明仅匹配其自身 path/realpath；命令名匹配当前平台的 inventory 标识或文件名，Windows 按既有规则处理大小写与可执行后缀。probe 仅采纳 provider 与目标均匹配的记录，不能仅因 provider 相同就采用另一个目标的历史探测结果。模型的 cli 与当前覆盖目标不一致、且缓存无法证明实际执行目标时，不把这条 probe 当作该覆盖目标的解析成功证据。

复用既有缓存有效期，不增加定时器或新探测系统。inventory 中匹配的有效 present 记录支持 true，gone 记录不支持；匹配 probe 的整数 exit（包括非零退出或输出无法解析）支持已解析，command missing 支持 false，不能把 auth、nonce、版本解析失败等同于命令缺失。候选证据冲突时以较新有效观察为准，同一时刻缺失优先；没有有效观察时为 false。仅配置 cli 或仅有 unverified 状态不能凭空变成 true。界面说明状态依据最近发现/探测结果，无证据时尚未确认，用户可运行既有刷新、探测操作更新。

读取 snapshot 不调用 discover、probeModels、providerStatus、checkProvider、外部 where/which 或 CLI 子进程，不扫描新目录，不写业务状态，不新增网络访问。沿用原缓存损坏和旧配置处理，不能吞掉异常返回伪成功。已有 secret 后端读取行为保持，不得把它误计为 CLI 探测，也不能为摘要新增凭据读取。

hint 按现有配置格式给片段：v2 使用 discovery.cli_overrides 中的 provider 对象及 cli；有既有 W_CONFIG_V1 标记时使用旧 providers 对象。示例只合并相应映射，不声称整个片段是完整配置文件。下面是已有 claude provider 的 v2 示例，不新增配置版本或字段：

```json
{"discovery":{"cli_overrides":{"claude":{"cli":"claude"}}}}
```

当真实声明是绝对路径时，hint 仍只给可加入 PATH 的安全命令名示例；在 UI 文本解释如需绝对路径，应由用户在本地配置中把 cli 的值替换为本机可执行文件绝对路径。空 provider 映射可用仓库现有 claude 示例说明位置，但不能伪造已配置的 provider 行。

2. UI 增加「配置」区。

ui/render.mjs 负责转义后的配置区 HTML 和顶部引导；ui/app.mjs 在启动时通过现有页面的 main 容器动态挂载，与问题、模型标签内容平级，切换标签不隐藏配置区。不修改 ui/index.html，不创建页面路由，不引入构建。保留原问题默认选中、模型区显示、状态来源、会话鉴权和 15000ms 轮询。

配置区包含「配置」标题、可选择复制的真实配置路径（只读文本框或同等可选中文本）、provider / 声明的 cli / 解析状态三列表格，状态文字精确为「✔ 已解析」或「✘ 未找到」。说明带目录的 CLI 声明只显示文件名，以及此状态来自最近证据。路径必须作为文本/输入值展示，不设为任意链接、不触发打开文件或命令。

仅以既有 snapshot.models 中是否存在 availability.state === 'callable' 判断顶部引导的显示条件；不从 resolved、版本号、白名单或预测余额推断模型可调用。models=[] 也显示引导。有 callable 时顶部引导不显示，配置区与表格仍显示；不得隐藏整个控制台。

顶部引导在默认问题标签也可见，包含「把 CLI 装进 PATH」及「把 cli 指向可执行文件绝对路径」两条可执行修复方向，展示 JSON 示例并解释合并位置。使用现有模型区刷新/探测按钮；引导明确告诉用户保存后到模型区刷新、探测，不自动提交 POST，不增加新的任务种类。

首次成功读到快照后渲染引导、路径和表格；下一次成功轮询同步更新，且不重复插入 section。读取失败保留上一份配置展示并使用现有 stale 状态，不改成未找到；恢复成功后更新。首次无历史的 unknown fallback 可能没有 config（lib/index.js 不在写域），此时兼容缺省，不伪造路径、不要求扩写 fallback，原错误与空态行为保持。

旧 UI 测试使用的最小 document mock 不一定具备 createElement、querySelector 或插入父节点的完整能力；新增 DOM 挂载应安全兼容这些既有 seam，不能为此删改原行为断言。新集成测试必须提供能验证实际挂载位置、可见性和输入值的 DOM seam，通过 startApp 的真实请求链验证新增功能，不能只测试未挂载的渲染字符串。

3. 每条 command missing 附带下一步。

保持 issues 每项现有 at、detail、evidence_ref、id、kind、subject 六键和全部值不变，特别是 detail 仍为原始 command missing，id 和证据引用不重算。不新增 action/next_step 字段，不修改范围外 issues-api.mjs。

ui/render.mjs 在每条对应问题的 article 内添加可见「下一步」段落，说明把该安全 CLI 名加入 PATH，或在显示的配置文件对应 provider 映射里将 cli 改为可执行文件绝对路径，再刷新/探测。保留原问题内容和证据。旧问题渲染分支如果包含 command missing 也同样补充；不能仅在页面顶部写一次来替代逐条说明。非 command missing 问题不误标成命令缺失。

路径、provider、cli、hint 和下一步中的动态文字统一使用既有 HTML 转义或 DOM 文本/值赋值，不能拼成可执行 HTML、脚本、外链或事件属性。配置路径只在配置区展示，问题条目仍不含真实主机目录。

## 约束

顶部 write_scope 是下游实现的完整七项范围，本 design 轮仅创建/修改同目录 design.md、acceptance.md，不修改代码、brief、attention、其他角色产物或状态，不执行 git，不创建其他文件。

两个新增授权的旧测试文件只做本轮裁决允许的增量更新；现有补丁已满足的部分保持，不重复改动。不得删测试、跳过测试、设置 only、改其他期望值或放宽断言来迁就实现：

- 正常顶层精确断言改为 ['at', 'config', 'forecast', 'issues', 'last_error', 'models', 'source']，不接受其他新键。
- 排除 config 和 issues 后，仍精确断言 ['at', 'forecast', 'last_error', 'models', 'source']。原有每一条字段值断言逐字保留；issues-from-probe 的 issue 六键、detail、probe-evidence、稳定 id 等断言全部保持。
- 对实际响应单独 assert.equal(snapshot.config.path, 实际配置文件绝对路径)。为脱敏检查创建响应的深拷贝，只 delete 副本.config.path，再对整个副本执行原来的 cw-private-person、PRIVATE_、secret/token 哨兵等否定断言，不能删除整个 config、不能放宽正则、不能全局替换路径文字。
- issues-from-probe 的 cw-discover-* 等同类真实路径哨兵检查也仅移除 config.path 后保留原正则，避免新授权路径被旧全响应检查误判；问题 HTML 不含路径的原断言继续原样执行。
- config.path 是唯一可回显实际配置绝对路径的字段；其值须精确相等。其余 config 字段、hint 内嵌 JSON 和快照其他字段均不增加绝对路径泄漏。新增隐私测试把 CLI 的绝对路径、原始 stdout/stderr、secret 引用及受控环境值分别放入不同字段，移除 config.path 后仍全部不可见。已存在的秘密/令牌哨兵不能因为路径豁免而绕过检查；config.path 之外的另一份配置路径也必须失败。

绝对 CLI 声明的原文展示要求按本轮隐私裁决收窄为安全文件名展示，真实绝对路径仅保留在本地配置。不要把路径重复放入 hint、问题下一步、source、provider 行或其他快照字段。

禁止修改 lib/exec.mjs、lib/probe.mjs、lib/catalog.mjs，以及范围外路由、配置迁移、secrets 模块、schema、package.json、索引、manifest 和追踪文件。不引入新依赖。不改变 callable 的既有证据要求或错误处理。测试夹具仅在 test/fixtures/ui/** 内按需添加，运行态临时数据使用测试环境临时目录，禁止在仓库生成批量产物。

## 建议验收方向

AC-090 只使用 brief 已指定的 integration 编号，不新增 AC。新建 test/integration/ui-config-guide.test.mjs，所有新增测试标题带 [AC-090]。使用 createPlugin、createHostStub、createContext、受控时钟与既有 probe/discover 入口，先获得真实缓存证据，再经 session 与真实 snapshot 路由进入 startApp；不使用替代 snapshot handler。通过注入 exec/文件系统 seam 隔离真实用户 CLI、账号和 PATH，不能读写真实用户配置。

功能测试覆盖：全 CLI command missing、无缓存、空 provider/空模型、已有匹配 present discovery、非零退出仍已解析、较新缺失覆盖较旧成功、不同 provider/路径不能误匹配、全部不可调用以及至少一个 callable；同一份可控页面完成失败保留、成功恢复、轮询更新和标签切换。用受控数据验证 v1/v2 hint 可解析且只包含既有配置位置，真实绝对 CLI 路径不泄漏，HTML 特殊字符安全转义。

集成测试同时核对 API 的精确七键、config 三键和 provider 三键/布尔类型、真实 config.path，以及 DOM 中的路径、三列表格、引导显隐和每条 command missing 的下一步。不得只证明渲染工具函数返回字符串，或只搜索源代码中文字。原问题数据逐项保持、无秘密泄漏、GET 不新增探测/写入/网络访问都要通过行为计数与实际响应检查。

acceptance.md 中每个 pwsh 块是一条完整独立命令，调度器按既有方式作为 ps1 执行；不由 design 轮创建脚本。先执行新集成，再执行两个授权旧测试和旧配置集成，最后由下游运行 scripts/check-fast.ps1。设计轮只运行无落盘的格式自检与文档核对；产品测试在实现尚未完成时不能宣称通过。所有检查失败如实报告，不扩大写域或修改检查器。
