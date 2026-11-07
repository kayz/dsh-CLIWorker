# CLIWorker

AgentLine 的独立模型层。AgentLine 只保留“模型来源”指针；provider/CLI、模型列举、可用性、价格、用量与预测全部由 CLIWorker 负责。

## 边界

```text
AgentLine  --ModelRequest JSON-->  CLIWorker  --ModelSelection JSON-->  AgentLine
```

- AgentLine 不读取 provider CLI、不维护价格表、不做预测。
- CLIWorker 可以独立安装、替换、禁用。
- AgentLine 的 `modelSource` 只保存 CLIWorker 的启动配置。

## CLI

```bash
node bin/cliworker.mjs providers
node bin/cliworker.mjs models list
node bin/cliworker.mjs models list --all
node bin/cliworker.mjs models select --request '{"role":"dev","tier":"top","count":2,"importance":"high"}'
node bin/cliworker.mjs models forecast --model hy4free
node bin/cliworker.mjs usage record --json '{"model":"hy4free","input_tokens":1000,"output_tokens":500}'
node bin/cliworker.mjs usage summary
```

所有输出都是 JSON。

## 配置

默认配置：`$CLIWORKER_HOME/config.json`（默认 `~/.cliworker/config.json`）。  
参考 `config/cliworker.example.json`。

配置包含：

- providers：CLI、adapter、版本/认证命令、是否可强制只读
- models：provider、id、tier、identity、vendor、价格、弃用
- quotas：各渠道剩余额度/窗口

## AgentLine 集成

AgentLine 仅保存：

```json
"modelSource": {
  "kind": "cliworker",
  "command": "node",
  "args": ["C:/git/dsh-CLIWorker/bin/cliworker.mjs", "--config", "C:/git/dsh-CLIWorker/config/cliworker.local.json"]
}
```

选模时调用：

```text
cliworker models select --request <ModelRequest>
```

返回的 `models[]` 是 `ModelHandle[]`，AgentLine 按顺序尝试。

## 安全

- 未验证 identity、不可调用、弃用模型不会出现在候选中。
- `rejected[]` 保留原因，便于审计。
- 预测缺样本返回 `unknown`，不伪造通过。

