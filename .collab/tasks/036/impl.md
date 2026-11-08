# 实现记录

新增模型表静态检查器，从示例配置和 model/v1 示例收集名称，扫描源码字面量并报告位置和片段；新增夹具测试覆盖阈值、嵌套、词法干扰、白名单、声明变更及错误诊断。新增 enumerate flow 步骤，使用真实 CLI 并以现有 schema 校验记录。追加 AC-079 追踪分片及中央索引，保留旧索引兼容，更新对应冻结摘要与追踪测试。

自测：`node scripts/check-no-model-table.mjs` 输出 `AC-079 OK`；`node --test test/unit/check-no-model-table.test.mjs` 六项通过；中央追踪 JSON 检查与冻结清单检查通过；追踪、milestone、lock、models enumerate/add 五个单元测试文件合计 35 项通过。

尚未满足全部验收：`node --test test/flows/flow.test.mjs` 中 enumerate 返回退出码 3。现有 flow 夹具使用 config/v1 的 `models.q`，现有模型目录要求 `catalog.manual`，而设计明确要求传入 `flow.config_path`、不修改 flow 配置，并禁止修改模型代码。评审提出的另写 v2 配置并改用其路径与这项要求冲突；修改 flow 夹具也超出写入范围。独立 flow 验收同样受此阻塞。

`node scripts/check-contract-doc.mjs` 报告 `docs/contract.md` 过期：本任务追加中央索引条目改变了文档内嵌摘要，但该文档不在写入范围。评审提供的 CI 结果显示完整单元测试通过；本实现会话没有运行该命令或 check-fast，因为它们会间接调用 git，与任务禁令冲突。check-fast 因此没有本会话的通过证据，且上述 flow 和契约文档问题仍会阻碍完整门禁。
