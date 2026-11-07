# CLIWorker 需求（v1.0 目标）

> 目标仓库：`C:\git\dsh-CLIWorker`
> 定位：AgentLine 的独立模型层插件，负责 provider/CLI、模型目录、身份、可用性、价格、额度、预测、选模与调用协议。
> AgentLine 不再评估模型。

## 1. 硬边界

CLIWorker 拥有：

- CLI/provider 发现、版本、认证
- 模型列举、白名单、等级、弃用
- 模型身份与证据来源
- 价格、剩余额度、消耗速度、预测
- 选模、排序、降级、拒选原因
- 返回可执行的 CLI 调用与 session 协议

AgentLine 只拥有：

- 指定 `level / count / usage`
- 接收 `ModelSelection`
- 按顺序执行 `calls[]`
- 数量不够时再申请
- 记录流程状态
- 持有 session id（但不解析 provider 的 resume 参数）

CLIWorker 不持有 AgentLine 的 session；只提供 session 协议。

## 2. 公共契约

### 2.1 ModelRequest v1

```json
{
  "level": "Top",
  "count": 2,
  "usage": "Heavy",
  "role": "designer",
  "stage": "blueprint",
  "exclude": ["hy4free"],
  "require_readonly": true,
  "require_identity": "observed",
  "cwd": "C:/git/dsh-Agentline"
}
```

字段：

- `level`：`Top | High | Middle | Quick`，必填
- `count`：1..10，必填
- `usage`：`Heavy | Normal | Light`，默认 `Normal`
- `role/stage`：用于策略与审计
- `exclude`：已用/失败模型
- `require_readonly`：需要强制只读
- `require_identity`：`verified | observed | unverified`，默认由角色决定
- `cwd`：CLI 调用的工作目录

### 2.2 ModelSelection v1

```json
{
  "schema": "cliworker.selection/v1",
  "ok": true,
  "level": "Top",
  "usage": "Heavy",
  "models": [],
  "calls": [],
  "rejected": [],
  "truncated": false,
  "reason": null
}
```

要求：

- `models.length <= count`
- `calls` 与 `models` 一一对应，顺序一致
- 数量不足返回 `truncated: true`，不得用低等级模型静默补齐
- 无候选时 `ok:false`，`reason` 为稳定错误码
- `rejected[]` 必须含 `key/reason/evidence`，能审计

### 2.3 ModelHandle v1

```json
{
  "schema": "cliworker.handle/v1",
  "key": "hy4free",
  "provider": "codebuddy",
  "id": "hy4free",
  "level": "Top",
  "vendor": "tencent",
  "identity": {
    "status": "verified",
    "source": "stream-json",
    "evidence": "session_id=...",
    "checked_at": "2026-11-07T10:00:00Z"
  },
  "readonly": true,
  "prices": {},
  "quota": {},
  "forecast": {},
  "call": {},
  "session": {}
}
```

### 2.4 错误码

至少：

- `E_CONFIG`
- `E_LEVEL_REQUIRED`
- `E_NO_ELIGIBLE_MODEL`
- `E_FORECAST_EXHAUSTION`
- `E_IDENTITY_UNVERIFIED`
- `E_PROVIDER_UNAVAILABLE`
- `E_PROVIDER_AUTH`
- `E_MODEL_DEPRECATED`
- `E_READONLY_UNAVAILABLE`
- `E_SELECTION_TRUNCATED`
- `E_CONTRACT_VERSION`
- `E_TIMEOUT`
- `E_PARTIAL_FAILURE`

错误必须结构化：`{ code, message, hint, evidence, retryable }`。

## 3. Provider 与 CLI

1. 扫描 Linux / macOS / Windows / WSL。
2. 支持多发行版枚举；不能只读当前 distro。
3. 已知 CLI：codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode。
4. 未知 CLI 发现后标记 `unrecognized`，允许用户手工补录。
5. 发现结果落盘：路径、版本、平台、探测时间、证据；支持增量刷新。
6. 认证 token 由用户提供；不得写入仓库、日志或 JSON 输出。
7. 每个 provider 描述：
   - `cli`
   - `adapter`
   - 平台
   - 只读能力
   - 模型列举方式
   - 认证检查
   - session 启动/resume 协议
   - 身份证据来源
8. provider 探测必须有超时、缓存、失败回退；不能每次选模同步扫全盘。

## 4. 模型目录

1. 模型 id、provider、vendor、canonical_id、identity_group。
2. 四档：`Top / High / Middle / Quick`。
3. 等级来源必须可追溯：配置/CLI 声明/实测。
4. 白名单：用户显式选择；不在白名单的模型：
   - 不进入候选
   - 不探测
   - 不计费
   - 只在 `rejected[]` 或管理页出现
5. 弃用模型：
   - `deprecated: true`
   - 不可选、不可进白名单、不可 fallback
   - 明确原因和替代模型
6. 别名/版本归一：
   - 同一底层模型不能因渠道/别名被算成两个
   - `identity_group` 必须稳定
7. 每个模型记录：
   - 上下文
   - 只读能力
   - 价格（输入/输出 per Mtok）
   - 计划额度/充值额度
   - 最近 probe
   - 最近 usage

## 5. 可用性与身份

1. 可用性状态：`unknown | discovered | unverified | callable | blocked | unavailable | deprecated`。
2. “已安装”不等于可用；必须小 token 真实调用 probe。
3. 身份等级：
   - `verified`：本次 stdout/usage 能自证
   - `observed`：旁路证据（如 codex rollout 文件）
   - `unverified`：调用成功但无身份字段
   - `failed`：调用失败/认证/限流
4. `unverified` 不阻断，只有 `failed` 才降级候选。
5. 旁路证据不能冒充本次 stdout 证据。
6. probe 记录：
   - model_resolved
   - source
   - latency
   - tokens
   - evidence
   - checked_at
7. provider 能力声明必须明确是否支持强制只读。

## 6. 额度、价格与预测

1. 读取各 CLI 的计划额度/余额：
   - Claude 5h/7d
   - Codex 周额度
   - CodeBuddy credits
   - DeepSeek 余额
   - 其他 provider 自定义
2. 额度形状必须归一：
   - `remaining_pct`
   - `remaining` + `unit`
   - `remaining_usd`
   - `reset_at`
3. 记录窗口起点/重置时刻。
4. 使用量：
   - 任务前后 input/output tokens
   - cache read/write
   - cost
   - 按模型/渠道/任务记录
5. 预测：
   - burn per task
   - burn per hour
   - p75/EWMA
   - tasks_left
   - eta_hours
   - confidence
   - risk：ok / low_reserve / critical / exhausted / unknown
6. 统一到 AgentLine 自己的预测，不直接相信 CLI 百分比。
7. `Heavy` 任务必须过滤 `critical/exhausted/low_reserve`；`Light` 可优先低成本。
8. 先计划内额度，快见底再用充值额度；保留原因。
9. 缺样本必须 `unknown`，不能伪造。
10. 预测算法需可注入时钟，支持确定性测试。

## 7. 选模与 CLI 调用

1. 按 `level` 精确过滤；不得静默降级。
2. 按 `usage` 调整排序和储备。
3. 过滤：
   - 弃用
   - 白名单外
   - 不可调用
   - 身份不符
   - 只读不满足
   - 预测耗尽
4. 排序：
   - Heavy：剩余可跑任务优先，其次价格
   - Normal：价格/余量平衡
   - Light：低成本优先
5. 返回：
   - `models[]`
   - `calls[]`
   - `rejected[]`
   - `truncated`
6. `calls[]` 必须可直接执行：
   - command
   - args
   - input（stdin/text）
   - cwd
   - env 白名单
   - timeout
7. 不返回完整 token/密钥。
8. 数量不足时由 AgentLine 用 `exclude` 再申请。

## 8. Session 协议

CLIWorker 不持有 session，但必须返回：

```json
{
  "session": {
    "supported": true,
    "start": { "command": "...", "args": [], "input": "stdin" },
    "resume": { "command": "...", "args": ["--resume", "{session_id}"], "input": "stdin" },
    "id_from": "stdout_json",
    "id_path": "session_id",
    "reset_on": ["model_change", "provider_change", "contract_change"]
  }
}
```

要求：

- AgentLine 自己保存 `session_id`
- CLIWorker 只提供启动/resume 描述
- 不支持的 provider 明确 `supported:false`
- resume 失败返回稳定错误码

## 9. 插件接口

Host 路由：

- `GET /cliworker/providers`
- `GET /cliworker/models`
- `POST /cliworker/select`
- `GET /cliworker/forecast?model=...`
- `POST /cliworker/usage`
- `GET /cliworker/health`

要求：

- GET 只读
- 写操作只通过明确 endpoint
- 不写 `.collab`
- 不泄漏原始配置/凭据
- 插件可独立安装/禁用
- 配置路径与 `CLIWORKER_HOME` 一致
- usage 默认落在 `$CLIWORKER_HOME/usage.jsonl`，与 `--config` 解耦

## 10. 模型管理界面

至少：

- 白名单
- 四档
- 可用性/身份
- 余量/重置时间
- 最近 probe
- 价格
- 弃用
- 最近使用

要求：

- 缺失显示 unknown
- 失败显示错误和重试
- 不伪造数据
- 黑白主题（后续 AgentLine 1.0.0-rc 共用设计 token）

## 11. 安全与可靠性

1. 零第三方运行时依赖。
2. 密钥/令牌不落盘、不进日志、不进 JSON。
3. 子进程参数不经 shell 拼接；Windows `.cmd` 用安全包装。
4. 并发选择/申请安全。
5. 重试不重复扣减/不重复记 usage。
6. 超时、认证失败、限流可分类。
7. 崩溃后状态可恢复。
8. 不返回假 handle。

## 12. 测试与发布

必须：

- `npm test`（Node 20+）通过
- 契约测试：schema 正反例
- provider fixture
- 预测确定性测试（固定时钟）
- 选模正反例（白名单、弃用、身份、只读、额度）
- CLI/插件 e2e
- 真实 provider 冒烟（不写入发布证据的 fake）
- `npm pack` 包含 `bin/`、`config/`、`lib/`、`dsh.plugin.json`
- `dsh-cliworker` 安装/升级/回滚验证

## 13. 迁移要求

当前实现需修掉：

1. 配额形状与预测器不匹配
2. `package.json` 缺 `bin`、`files` 漏 `bin/`/`config/`
3. 无 `scripts`，`node --test test` 在 Node 22 报错
4. usage 路径与 `--config` 不一致
5. `.gitignore` 规则不命中实际 usage
6. `cli` 与 `call` 重复输出
7. 未使用导入/变量
8. `config=null` 抛 TypeError
9. Windows `shell:true` 参数风险
10. 每次选模同步探测全部 provider（无缓存）
11. 每个模型重复计算 forecast
12. README 请求示例字段被忽略

## 14. 验收清单

- [ ] 四档与 count/usage 契约
- [ ] 白名单/弃用/身份/只读/额度过滤
- [ ] `calls[]` 可直接执行
- [ ] session 协议
- [ ] provider 发现/模型列举/probe
- [ ] 额度归一与预测
- [ ] 插件路由/健康检查
- [ ] 模型管理界面
- [ ] 安全/并发/重试
- [ ] 测试/打包/安装
- [ ] AgentLine 只依赖 ModelRequest/ModelSelection

## 15. 非目标

- 不实现 AgentLine 的 Studio/Blueprint/Build 流程
- 不持有 AgentLine session
- 不管理 AgentLine 任务状态
- 不修改 AgentLine 仓库

## 16. 实施顺序

1. 契约与测试骨架
2. provider 发现/模型列举/probe
3. 白名单/等级/弃用/身份
4. 额度/usage/预测
5. 选模 + calls + session 协议
6. 插件路由/UI
7. 打包/安装/发布
8. 修掉第 13 节全部缺陷
