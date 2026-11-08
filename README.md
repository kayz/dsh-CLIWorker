# CLIWorker

CLIWorker 为 AgentLine 提供模型选择与包装调用。需要 Node 20 或更高版本；安装包提供 `cliworker` 入口，源码中使用 `node bin/cliworker.mjs`。

`config/cliworker.example.json` 是 v1 参考模板，直接运行会返回 `E_CONFIG_EXAMPLE`；`init` 也不会自动将模板变成可调用配置。请按自己的环境准备配置；v2 使用 `catalog`、`discovery` 和 `pools`，不要将 v1 的 `providers`、`models`、`quotas` 当作 v2 结构。密钥使用环境变量或 SecretRef。

以下可运行标记由文档检查器提供离线测试配置；真实使用前须准备自己的可调用配置。

可运行：
```pwsh
node bin/cliworker.mjs models select --request '{"schema":"cliworker.request/v1","request_id":"example-1","level":"Top","count":1,"usage":"Normal","importance":"normal"}'
node bin/cliworker.mjs models list
node bin/cliworker.mjs usage summary
```

选择结果中的 `calls` 应按返回顺序执行。实际执行调用时需提供非空 `request_id`，以便记录调用信息；新申请使用不同的标识。未知请求字段会产生 `W_FIELD_IGNORED`，这是兼容行为，不应依赖被忽略的字段。旧字段和视图的迁移见[迁移指南](docs/migration.md)。

相同的请求数据可以准备为 JSON 文件：

```json request
{"schema":"cliworker.request/v1","request_id":"example-1","level":"Top","count":1,"usage":"Normal","importance":"normal"}
```

不可运行：以下写法需要已配置的实际环境，文件示例须先保存上面的请求数据。
```bash
node bin/cliworker.mjs models select --request '{"schema":"cliworker.request/v1","request_id":"example-1","level":"Top"}'
node bin/cliworker.mjs models select --request-file request.json
```

- [AgentLine 集成](docs/agentline-integration.md)
- [界面与会话](docs/ui.md)
- [平台差异](docs/platforms.md)
- [宿主契约](docs/host-contract.md)
