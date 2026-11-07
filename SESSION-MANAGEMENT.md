# CLIWorker Session 管理需求

> 范围：只定义 CLIWorker 与 AgentLine 之间的 session 协议与生命周期边界。
> 不修改 `REQUIREMENTS.md` 的完整需求。

## 1. 职责边界

CLIWorker：

- 提供 provider 的启动 / resume 调用描述
- 声明 session 是否支持
- 声明 session id 从哪里读取
- 声明哪些变化会使 session 失效
- 不持有 session 状态、不保存对话内容

AgentLine：

- 创建 session
- 保存 `session_id`
- 决定何时 resume / 何时新建
- 按角色隔离
- 记录 session 与任务、轮次、上下文的关联
- 调用前后上报 usage

## 2. 角色级 session 策略

| 角色 | session 策略 |
|---|---|
| design | 同一任务跨轮复用 |
| design pre-review | 复用 design session |
| dev | 同一任务跨轮复用；修 bug 回原 session |
| review | 每次 review 新建独立 session |
| test_architect | 每轮或每次独立，按流程配置 |

review 不得复用 design/dev session。  
design pre-review 只能算作者自检，不能替代独立 review。

## 3. ModelHandle.session 契约

```json
{
  "session": {
    "supported": true,
    "start": {
      "command": "codebuddy",
      "args": ["-p", "--model", "hy4free", "--output-format", "stream-json"],
      "input": "stdin",
      "cwd": "<workspace>"
    },
    "resume": {
      "command": "codebuddy",
      "args": ["--resume", "{session_id}"],
      "input": "stdin",
      "cwd": "<workspace>"
    },
    "id_from": "stdout_json",
    "id_path": "session_id",
    "reset_on": ["model_change", "provider_change", "contract_change"],
    "supports_resume": true
  }
}
```

要求：

- `start` 与 `resume` 均为可执行调用描述
- `{session_id}` 由 AgentLine 替换，不允许自行拼接 shell
- `id_from` 支持：
  - `stdout_json`
  - `stdout_regex`
  - `stderr_regex`
  - `sidecar_file`
- `id_path` 只用于 JSON 路径
- 不支持 resume 时 `supports_resume:false`，并给出原因
- 不允许返回 provider 原始凭据

## 4. AgentLine 侧 session 记录

建议路径：

```text
.collab/tasks/<id>/sessions/<role>.json
```

示例：

```json
{
  "schema": "agentline.session/v1",
  "task": "003",
  "role": "dev",
  "round": 2,
  "model_key": "hy4free",
  "provider": "codebuddy",
  "model_id": "hy4free",
  "session_id": "sess_abc",
  "call_spec_digest": "sha256:...",
  "context_digest": "sha256:...",
  "started_at": "2026-11-07T10:00:00Z",
  "last_used_at": "2026-11-07T10:20:00Z",
  "status": "active",
  "resume": {
    "command": "codebuddy",
    "args": ["--resume", "sess_abc"],
    "input": "stdin"
  }
}
```

状态：

- `active`
- `expired`
- `archived`
- `failed`

写入必须原子化；`session_id` 只能出现在任务目录，不进入全局日志。

## 5. 生命周期

### start

1. AgentLine 向 CLIWorker 请求 ModelSelection
2. 选中的 ModelHandle 必须带 `session.start`
3. AgentLine 执行 start
4. 从 `id_from/id_path` 读取 `session_id`
5. 落盘 session 记录
6. 上报 usage

### resume

1. 读取上一轮 session 记录
2. 检查 `status=active`
3. 检查模型、provider、call spec、contract 未变化
4. 用 `session.resume` + `session_id` 调用
5. 更新 `last_used_at`
6. 上报 usage

### invalidate

以下任一情况必须新建 session：

- 模型 key 改变
- provider 改变
- CLI 版本不兼容
- session 过期
- resume 返回 `E_SESSION_NOT_FOUND` / `E_SESSION_EXPIRED`
- 上下文摘要重建
- 任务切换
- review 新轮次

失效时：

- 旧 session 标记 `expired/archived`
- 不假装 resume 成功
- 用上下文摘要 + 当前 diff 新建 session

## 6. 上下文与 token

session 复用不等于不控制 token。

每轮发送：

- 上一轮增量 diff
- 新 findings / 失败证据
- 新的约束
- 必要上下文摘要

不重复发送：

- 完整 brief
- 完整 design
- 完整项目文档

要求 CLIWorker / AgentLine 共同记录：

- input_tokens
- output_tokens
- cache_read_tokens
- cache_write_tokens
- total_tokens
- cost

没有 cache 命中时，应能看出“同 session 并没有省钱”。

## 7. 模型与额度刷新

AgentLine 不每次拉全量模型列表。

缓存：

```text
task -> role -> ModelHandle + selection_id
```

重新请求模型列表仅当：

- 首次选模
- 当前模型不可用
- 额度预测不足
- 数量不够
- 配置/版本变化
- 用户显式换模

每轮轻量检查：

```text
GET /cliworker/forecast?model=<key>
```

如果预测为 `critical/exhausted`：

- 结束当前 session
- 重新申请替代模型
- 新建 session
- 用摘要 + diff 续接

## 8. 错误码

- `E_SESSION_UNSUPPORTED`
- `E_SESSION_ID_MISSING`
- `E_SESSION_START_FAILED`
- `E_SESSION_RESUME_FAILED`
- `E_SESSION_NOT_FOUND`
- `E_SESSION_EXPIRED`
- `E_SESSION_MODEL_CHANGED`
- `E_SESSION_CONTRACT_CHANGED`

所有错误必须可重试/不可重试明确。

## 9. 测试要求

- start 成功并解析 session_id
- resume 成功并复用
- 模型变化拒绝 resume
- session 过期拒绝 resume
- 无 session 支持时明确报错
- 并发同一 session 的互斥
- 失败不写半截 session 记录
- review 每轮新 session
- design/dev 跨轮复用
- usage 在 start/resume 后都上报
- 固定时钟下的过期测试

## 10. 非目标

- CLIWorker 不保存对话内容
- CLIWorker 不保存 session_id
- CLIWorker 不决定设计/评审角色
- AgentLine 不解析 provider resume 参数
