# Task 004 — 契约冻结：自包含注册表、仓库内规格与金标、示例、校验器、视图扫描器、禁止引用 .collab

## 目标

来自 Blueprint 任务图 T-004（M1）。交付：
- lib/contract/registry.mjs、validate.mjs、views.mjs、scan.mjs
- contracts/registry.snapshot.json（码含 trigger_id、http_status）
- contracts/spec/surfaces.json、migration-map.json
- contracts/golden/quota-shapes.json、b44.json、forecast/*.json、capacity.json、policy/*.json
- contracts/examples/**、contracts/schemas/**、contracts/agentline-forbidden.json
- scripts/snapshot-update.mjs、gen-contract-doc.mjs、check-contract-doc.mjs、check-no-collab.mjs
- docs/contract.md（生成）

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/contract/**
  - contracts/registry.snapshot.json
  - contracts/spec/surfaces.json
  - contracts/spec/migration-map.json
  - contracts/golden/**
  - contracts/examples/**
  - contracts/schemas/**
  - contracts/agentline-forbidden.json
  - scripts/snapshot-update.mjs
  - scripts/gen-contract-doc.mjs
  - scripts/check-contract-doc.mjs
  - scripts/check-no-collab.mjs
  - docs/contract.md
  - test/fixtures/no-collab/**
  - test/contract/registry.test.mjs
  - test/contract/examples.test.mjs
  - test/contract/freeze.test.mjs
  - test/contract/scan-canary.test.mjs
  - test/contract/spec-tracked.test.mjs
  - test/traceability/T-004.json
  - contracts/golden/manifest.json
  - scripts/check-golden-frozen.mjs
  - scripts/check-write-scope.mjs
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-009（levels: contract）：lib/contract/registry.mjs 与 contracts/registry.snapshot.json 深相等；每个码都有 exit、http_status、retryable、trigger_id、trigger，trigger_id 全表唯一，不存在两个码共用一个触发条件；E_VIEW_FORBIDDEN、E_LOOPBACK_ONLY、E_ADMIN_REQUIRED、E_READONLY、E_CSRF 的触发互斥，写路由判定顺序登记为会话、readonly、csrf、请求体。contracts/examples 下的正例全部通过校验；每个反例都失败，且错误路径与样例声明一致。
- AC-010（levels: contract）：冻结规则测试：在注册表副本上删除一项、改名一项，compareRegistry 分别报告 removed、removed+added，测试失败；只新增但快照未更新时失败；snapshot:update 后 snapshot_version 必须加 1，否则失败。拒选原因、risk 阈值、可用性、警告码、draft 映射、semantic_change 都在快照中。
- AC-011（levels: contract, unit）：视图扫描器：禁用键在任意深度（对象、数组、warnings、error、rejected 内）都被检出，大小写不敏感精确匹配；禁用值按切词后的整词匹配目录里的模型 id、key 和 CLI 可执行名；call 子树不做值扫描，但必须逐项等于包装模板。canary：每个禁用键和值在深度 1 和 3 注入后都被检出；干净样例 0 命中；cliworker、config、dsh-CLIWorker 不会误报。
- AC-073（levels: contract, unit）：权威规格自包含且可判据（F-02 加强）：contracts/registry.snapshot.json、contracts/spec/*.json、contracts/golden/** 均被 git 跟踪（git ls-files 列出）并通过各自 schema 校验；contracts/spec/** 与 contracts/golden/** 由 contracts/golden/manifest.json 逐文件登记 sha256，check-golden-frozen 在任一文件增删改时失败，且该检查已纳入 check-fast；check-write-scope 报出登记清单之外的 golden/spec 文件，以及落在任务 write_scope 之外的变更。例外：contracts/registry.snapshot.json 不做哈希冻结，只做 snapshot_version 递增 + compareRegistry 语义比较，v0.1 副本仅作回归夹具；该例外优先于任何字面冻结要求。check-no-collab 对 lib、scripts、test、contracts、docs、package.json 报告 0 处 .collab 引用，对 test/fixtures/no-collab 下的违规样例报出；gen-contract-doc 重新生成的 docs/contract.md 与已提交版本逐字节一致；registry.snapshot.json 含 interfaces 第 5 节的全部码、触发、阈值、原因、映射与 semantic_change。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-009
- node scripts/run-tests.mjs --ac AC-010
- node scripts/run-tests.mjs --ac AC-011
- node scripts/check-no-collab.mjs
- node scripts/check-contract-doc.mjs
- node scripts/run-tests.mjs --ac AC-073

测试层级：contract, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
