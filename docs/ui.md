# 界面与会话

`/cliworker/ui` 读取 `/cliworker/api/snapshot` 快照展示状态。异步操作返回 job_id，使用 `/cliworker/api/jobs/<id>` 读取 queued、running、succeeded 或 failed 状态；失败时查看 last_error 和 error。HTTP 管理会话从 `/cliworker/api/session` 获取，返回 session、csrf、expires_at；请求分别使用 `x-cliworker-session` 和 `x-cliworker-csrf` 头，勿放入 URL 或 cookie。会话保存在内存，过期或进程重启后失效。写请求按 session、readonly、csrf、body 的顺序检查，分别可能返回 `E_ADMIN_REQUIRED`、`E_READONLY`、`E_CSRF`，之后才解析请求体。入口分别检查 socket 地址、Host 以及存在时的 Origin 是否为 loopback；转发头不能代替真实来源，失败返回 `E_LOOPBACK_ONLY`。

模型对话是另一个程序接口：`startSession(ctx, { target, input, timeout_ms })` 返回结果和可恢复时的不透明 `session_token`；`resumeSession(ctx, { target, token, input, forecast, ttl_s, timeout_ms })` 验证后恢复。target 包含模型、来源、工作目录及会话描述；start 的 input 可包含 prompt、summary、diff、findings、constraints，resume 只接受后四项。结果包含 action、reply、identity、error 和可恢复时的 session_token。模型、来源、调用契约不匹配或过期会失效；恢复失败应处理结果并按需开始新会话。`role` 属于会话策略接口，不属于选模请求；该接口不是会话 CLI 命令或 HTTP 路由。

以下示例使用检查器提供的离线配置；真实使用前须准备可调用配置。

可运行：
```pwsh
node bin/cliworker.mjs usage summary
```
