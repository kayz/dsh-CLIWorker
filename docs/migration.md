# 迁移

### forecast.tasks_left

旧预测可能以剩余额度近似任务数；现值以任务为单位，由可用容量及使用样本估算，美元依据使用成本样本。缺少样本、容量、换算或窗口等证据时为 null，依据为 none；调用方必须把它当未知处理。

### forecast.risk

旧值不能作为新风险枚举的直接等价物。现值为 ok、low_reserve、critical、exhausted 或 unknown，按 tasks、usd、fraction 的顺序选择依据。任务数小于等于 0、2、5 分别为 exhausted、critical、low_reserve；剩余比例小于等于 0、小于 0.05、小于 0.15 分别对应这些等级。缺少依据为 unknown，调用方不能把 unknown 当作通过。

### handle.cli_removed

旧直接调用字段已移除；现使用返回的包装调用模板。管理完整视图可见 detail 中的管理字段，AgentLine 视图只提供调用所需信息。调用方应改为按顺序执行返回的调用。

### draft_reason_mapping

旧 draft 原因映射为 v1 原因，见下表；调用方应更新匹配逻辑。draft 视图带弃用警告，选择失败应依据实际错误和退出码处理。

### config_v1_to_v2

旧 v1 配置在内存中迁移到 v2 并产生 `W_CONFIG_V1`；调用方应检查迁移结果并使用 `config migrate --in` 与 `--out` 显式持久化。输入和输出须不同，输出已存在时返回 `E_CONFIG_EXISTS`。未知容量仍是未知，不应假定有容量。映射和换算见下表。

## 映射

| id | 来源 | 目标 | 说明 |
| --- | --- | --- | --- |
| `draft.reason.excluded` | `excluded` | `excluded` | 原因码映射 |
| `draft.reason.not_in_workspace_order` | `not_in_workspace_order` | `excluded` | 原因码映射 |
| `draft.reason.level` | `level:<Level>` | `level_mismatch` | 原因码映射 |
| `draft.reason.availability_unverified` | `availability:unverified` | `availability_unverified` | 原因码映射 |
| `draft.reason.availability_blocked` | `availability:blocked` | `availability_blocked` | 原因码映射 |
| `draft.reason.availability_unavailable` | `availability:unavailable` | `availability_unavailable` | 原因码映射 |
| `draft.reason.availability_deprecated` | `availability:deprecated` | `deprecated` | 原因码映射 |
| `draft.reason.identity_unverified` | `identity_unverified` | `identity_unverified` | 原因码映射 |
| `draft.reason.readonly_unavailable` | `readonly_unavailable` | `readonly_unavailable` | 原因码映射 |
| `draft.reason.forecast_exhaustion` | `E_FORECAST_EXHAUSTION` | `quota_low` | 原因码映射 |
| `draft.field.key` | `handle.key` | `detail.model_key` | 仅管理完整视图 |
| `draft.field.provider` | `handle.provider` | `detail.cli` | 仅管理完整视图 |
| `draft.field.id` | `handle.id` | 移除 | AgentLine 视图不暴露模型 id |
| `draft.field.level` | `handle.level` | `level` | 不变 |
| `draft.field.prices` | `handle.prices` | 移除 | 价格属于管理视图的 model/v1 |
| `draft.field.quota` | `handle.quota` | `detail.pools` | 仅管理完整视图 |
| `draft.field.forecast` | `handle.forecast` | `detail.forecast` | 仅管理完整视图 |
| `draft.field.call` | `handle.call` | `call` | 包装调用模板 |
| `draft.field.cli` | `handle.cli` | 移除 | handle.cli_removed |
| `draft.field.readonly` | `handle.readonly` | `readonly` | 不变 |
| `draft.field.vendor` | `handle.vendor` | `detail.vendor` | 仅管理完整视图 |
| `draft.field.rejected_key` | `rejected[].key` | `rejected[].ref` | 不透明引用 |
| `draft.field.rejected_forecast` | `rejected[].forecast` | 移除 | 已移除 |
| `draft.field.reason` | `reason` | `error.code` | 映射到注册表代码 |
| `draft.field.request` | `request` | 移除 | 不再回显，保留 request_id |
| `config.schema` | `schema (absent or cliworker.config/v1)` | `schema` | 内存迁移为 cliworker.config/v2，产生 W_CONFIG_V1 |
| `config.models` | `models` | `catalog.manual`, `catalog.allow`, `catalog.levels` | level_source kind 为 config |
| `config.quotas.remaining_pct` | `quotas.<provider>.remaining_pct` | `pools` | plan，used_fraction = 1 - remaining_pct/100 |
| `config.quotas.credits` | `quotas.<provider>.remaining + credits` | `pools` | credits 类型 |
| `config.quotas.remaining_usd` | `quotas.<provider>.remaining_usd` | `pools` | prepaid_usd 类型 |
| `config.quotas.tokens` | `quotas.<provider>.remaining + unit tokens` | `pools` | 已知容量 |
| `config.providers` | `providers` | `discovery.cli_overrides` | 转为 CLI overrides |
