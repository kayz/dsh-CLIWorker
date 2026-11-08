# AgentLine 集成

请求使用 `schema` 值 `cliworker.request/v1`。`level` 为 Top、High、Middle、Quick，不区分大小写；`count` 是 1 到 10 的整数，默认 1。`usage` 为 Heavy、Normal、Light，不区分大小写，默认 Normal；`importance` 为 normal 或 high，区分大小写，默认 normal。

读取 `ok`、`count_requested`、`count_returned`、`shortfall`、`truncated`、`warnings` 和 `error`；返回数量可能不足。按返回顺序执行 `calls`，保留每项的 `command`、`args`、`cwd`、`input`、`output` 和 `timeout_ms` 含义，参数数组不能拼成 shell 字符串。通过 stdin 传入任务，逐行消费 `cliworker.event/v1` 的 start、text、usage、result、error 事件，结合退出码和终结事件判断结果；stdout 不是单个 JSON。

每项调用只能执行一次；过期后重新申请。全部失败或返回不足时再申请，需要避免重复时使用 `exclude_handles`。相同 `request_id` 用于重放原请求，新申请使用新的 `request_id`。

错误体的 `code`、`retryable` 和 `retry_after` 用于决定后续流程，不可重试的错误不要无限重试。命令行错误体与 HTTP 选模响应分别按各自入口解析。`E_REQUEST_INVALID`、`E_LEVEL_REQUIRED`、`E_LEVEL_UNKNOWN`、`E_SCHEMA_UNSUPPORTED` 的退出码为 2，修正请求后再试；`E_NO_CANDIDATE` 为 5 且不可重试；`E_INSUFFICIENT_QUOTA` 为 5 且可重试，应遵守返回的等待时间。`E_LEASE_UNKNOWN`、`E_LEASE_EXPIRED`、`E_LEASE_CONSUMED`、`E_LEASE_CONFIG_MISMATCH` 的退出码为 6，其中只有过期可重试，需重新申请。`E_TIMEOUT` 为 4 且可重试；`E_PROVIDER_AUTH`、`E_PROVIDER_QUOTA`、`E_PROVIDER_FAILED` 为 7 且不可重试，应先处理调用失败的原因。
