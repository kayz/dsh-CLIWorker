# 实现记录

新增模型表静态检查器，从示例配置和 model/v1 示例收集名称，扫描源码字面量并报告位置和片段；新增夹具测试覆盖阈值、嵌套、词法干扰、白名单、声明变更及错误诊断。新增 enumerate flow 步骤，使用真实 CLI 并以现有 schema 校验记录。追加 AC-079 追踪分片及中央索引，保留旧索引兼容，更新对应冻结摘要与追踪测试。

自测：`node scripts/check-no-model-table.mjs` 输出 `AC-079 OK`；`node --test test/unit/check-no-model-table.test.mjs` 六项通过；中央追踪 JSON 检查与冻结清单检查通过；追踪、milestone、lock、models enumerate/add 五个单元测试文件合计 35 项通过。

尚未满足全部验收：`node --test test/flows/flow.test.mjs` 中 enumerate 返回退出码 3。现有 flow 夹具使用 config/v1 的 `models.q`，现有模型目录要求 `catalog.manual`，而设计禁止修改 flow 配置和模型代码。`node scripts/check-contract-doc.mjs` 报告 `docs/contract.md` 过期，该文档不在写入范围。完整单元测试和 check-fast 会运行调用 git 的测试，与任务禁止执行 git 的约束冲突，因此未运行。独立 flow 验收同样受上述配置不兼容阻塞。
