# CLIWorker 契约（自动生成）
> 本文件由 scripts/gen-contract-doc.mjs 生成，请勿手改。snapshot_version: 1

## 1. 错误码

| code | exit | http_status | retryable | trigger_id | trigger |
| --- | --- | --- | --- | --- | --- |
| E_INTERNAL | 1 | 500 | false | internal_error | Unhandled exception or broken invariant inside CLIWorker |
| E_REQUEST_INVALID | 2 | 400 | false | request_invalid | Request field has an invalid type or value (level and schema have their own codes) |
| E_LEVEL_REQUIRED | 2 | 400 | false | level_missing | Request has no level |
| E_LEVEL_UNKNOWN | 2 | 400 | false | level_not_in_set | level is present but not Top, High, Middle or Quick (case-insensitive) |
| E_SCHEMA_UNSUPPORTED | 2 | 400 | false | schema_unsupported | schema is present but is not a supported version |
| E_UNSAFE_ARG | 2 | 400 | false | unsafe_argument | Argument or path rejected by the safe-execution rules |
| E_UNKNOWN_COMMAND | 2 | 404 | false | command_unknown | CLI command or sub-command is not in the command table |
| E_VIEW_FORBIDDEN | 2 | 403 | false | select_view_without_admin | select route asked for full or draft view without a valid session; CLI models select with view full |
| E_CONFIG | 3 | 500 | false | config_invalid | Config file is missing, unreadable or fails validation |
| E_CONFIG_EXAMPLE | 3 | 500 | false | config_is_example | Config has _example true or deep-equals the bundled example ignoring _example |
| E_CONFIG_EXISTS | 3 | 409 | false | config_exists | init would overwrite an existing config file |
| E_CONFIG_SECRET_INLINE | 3 | 400 | false | config_secret_inline | Config holds an inline secret value instead of a SecretRef |
| E_SECRET_BACKEND | 3 | 500 | false | secret_backend_failed | Secret backend is unavailable or rejected the read or write |
| E_STATE_LOCKED | 4 | 503 | false | state_lock_timeout | State lock was not acquired within lock_wait_ms |
| E_TIMEOUT | 4 | 504 | true | call_timeout | run exceeded timeout_ms and its process tree was killed |
| E_NO_CANDIDATE | 5 | 409 | false | no_candidate_available | No candidate passed the non-quota filters, or the rejections are not all quota-driven |
| E_INSUFFICIENT_QUOTA | 5 | 429 | true | all_candidates_quota_rejected | At least one candidate passed every non-quota filter and all such candidates were rejected by quota_low, reserve_protected or quota_unknown_policy |
| E_LEASE_UNKNOWN | 6 | 404 | false | lease_not_found | run was given a lease id that is not in the state directory |
| E_LEASE_EXPIRED | 6 | 410 | true | lease_past_expiry | Lease expires_at is earlier than now; the caller must request a new lease |
| E_LEASE_CONSUMED | 6 | 409 | false | lease_already_run | Lease was already used by an earlier run |
| E_LEASE_CONFIG_MISMATCH | 6 | 409 | false | lease_config_mismatch | --config or --state-dir passed to run differ from the ones recorded in the lease |
| E_PROVIDER_AUTH | 7 | 502 | false | provider_auth_failed | Provider CLI reported that it is not logged in or the token was rejected |
| E_PROVIDER_QUOTA | 7 | 429 | false | provider_quota_exhausted | Provider CLI reported that its own quota or rate limit is exhausted |
| E_PROVIDER_FAILED | 7 | 502 | false | provider_call_failed | Provider CLI exited non-zero for a reason other than auth or quota |
| E_ADMIN_REQUIRED | 8 | 403 | false | admin_route_no_session | Admin read or write route called without a valid session, including an expired one |
| E_LOOPBACK_ONLY | 8 | 403 | false | bootstrap_non_loopback | api/session or ui shell failed any of the three loopback checks |
| E_READONLY | 8 | 403 | false | write_route_readonly | Session is valid, the plugin is readonly, and the route is a write route |
| E_CSRF | 8 | 403 | false | write_route_csrf_invalid | Session is valid, the plugin is writable, and the csrf header is missing or does not match |
| E_HEALTH_DEGRADED | 9 | 503 | false | health_check_failed | At least one health check failed |
| E_SMOKE_DISABLED | 9 | 501 | false | smoke_not_enabled | Smoke command was invoked while smoke is not enabled |

退出码 0 表示成功（含 truncated），不是错误码，不进入本表。

## 2. 403 触发与判定顺序

| code | exit | trigger_id |
| --- | --- | --- |
| E_VIEW_FORBIDDEN | 2 | select_view_without_admin |
| E_ADMIN_REQUIRED | 8 | admin_route_no_session |
| E_LOOPBACK_ONLY | 8 | bootstrap_non_loopback |
| E_READONLY | 8 | write_route_readonly |
| E_CSRF | 8 | write_route_csrf_invalid |

写路由判定顺序：session > readonly > csrf > body。

## 3. 警告码

- W_FIELD_IGNORED
- W_FIELD_DEPRECATED
- W_CONFIG_V1
- W_STALE_DATA
- W_DRAFT_DEPRECATED
- W_MODELS_MANUAL_REQUIRED
- W_LEGACY_USAGE
- W_TEST_CLOCK

## 4. 拒选原因

### v1

- excluded
- level_mismatch
- level_unassigned
- availability_unverified
- availability_blocked
- availability_unavailable
- availability_stale
- deprecated
- identity_unverified
- identity_mismatch
- readonly_unavailable
- adapter_unverified
- quota_low
- quota_unknown_policy
- reserve_protected

### admin_only

- not_allowed

### draft

- excluded
- not_in_workspace_order
- level:<Level>
- availability:<state>
- identity_unverified
- readonly_unavailable
- E_FORECAST_EXHAUSTION

## 5. draft 到 v1 的原因映射

| draft | v1 |
| --- | --- |
| excluded | excluded |
| not_in_workspace_order | excluded |
| level:<Level> | level_mismatch |
| availability:unverified | availability_unverified |
| availability:blocked | availability_blocked |
| availability:unavailable | availability_unavailable |
| availability:deprecated | deprecated |
| identity_unverified | identity_unverified |
| readonly_unavailable | readonly_unavailable |
| E_FORECAST_EXHAUSTION | quota_low |

## 6. forecast 枚举与阈值

### forecast_reasons

- no_samples
- capacity_unknown
- ledger_capacity_unknown
- credits_conversion_missing
- usd_samples_missing
- reading_stale
- window_unknown

### risk

ok, low_reserve, critical, exhausted, unknown

### risk_basis

tasks, usd, fraction, none

### tasks_left_basis

tasks, usd, none

### thresholds.tasks

| risk | op | value |
| --- | --- | --- |
| exhausted | <= | 0 |
| critical | <= | 2 |
| low_reserve | <= | 5 |
| ok | else |  |

### thresholds.fraction

| risk | op | value |
| --- | --- | --- |
| exhausted | <= | 0 |
| critical | < | 0.05 |
| low_reserve | < | 0.15 |
| ok | else |  |

### thresholds.priority

tasks > usd > fraction > unknown

## 7. 可用性与 identity

### availability

unverified, callable, blocked, unavailable, deprecated

### identity

verified, unverified, mismatch

## 8. semantic_change

- forecast.tasks_left
- forecast.risk
- handle.cli_removed
- draft_reason_mapping
- config_v1_to_v2

## 9. 规格与金标登记清单

| path | sha256 |
| --- | --- |
| contracts/golden/b44.json | 0b914f53d4e1178d19a763e19ca9ac78d6246a5ed094610fdc543fe37faeb135 |
| contracts/golden/capacity.json | fbb812f2714d34fe45fe4fcfdfd44f78f55fb7dabb8c6f4326276aae9d96c993 |
| contracts/golden/forecast/burn-eta.json | 9fb862cfbeebc9547ce49bc3967c78b6190f4a717e653ce4129fab9f8ae87366 |
| contracts/golden/forecast/confidence.json | a1f3ba3ba88a86b60f3a6173d0c45a573943996eb050049953891b949af6b781 |
| contracts/golden/forecast/quantiles.json | 86da5e797e09bc2ae961abca558a02e50054f540712c8b3aa06f2c84eacf8927 |
| contracts/golden/forecast/thresholds.json | eb3185fdec62295274635ec77c87255455fe31d4349dad296bb0b2351eb6810b |
| contracts/golden/policy/p1-order.json | 790bddf2751cf69e9fa23e70f33655eef55e5951401fc47643bebae22421fac3 |
| contracts/golden/policy/p2-quota-low.json | fa3578883fa3fd6bece41f49ce3eeec1a32413f48408a428efb6c4bccd696349 |
| contracts/golden/policy/p3-unknown.json | 16fe9c34bff7ffb0722600b2f3427ea4e6b7f758bcee2a4c906979d2901c68e8 |
| contracts/golden/policy/p4-identity-group.json | 5bd4475e20f62f7c5391f2368b2df43bde4ba80ae7424c178302e3e69810a240 |
| contracts/golden/quota-shapes.json | 44670f30a6042767d187adceed5fc39cfa5846b40cd8aaa28eb11f939696467e |
| contracts/spec/ac-index.json | 65b265acdff161370a55ba23140495b2c89d102f8d323e61756783ee02ffcba6 |
| contracts/spec/migration-map.json | f68bae918ac4eeeffe6e13d7fbda98e8729059aacb44b0367eafb979ed794b1e |
| contracts/spec/surfaces.json | ce39945e4f694b04e509f6fe02ae995e635e439e51f8d4c314e8fae749c1846a |

## 10. 契约 schema 清单

- ac-index.schema.json
- agentline-forbidden.schema.json
- config.v2.schema.json
- error-envelope.schema.json
- event.v1.schema.json
- forecast.v1.schema.json
- golden-manifest.schema.json
- golden.schema.json
- handle-full.v1.schema.json
- handle.v1.schema.json
- inventory.v1.schema.json
- migration-map.schema.json
- model.v1.schema.json
- pool.schema.json
- registry-snapshot.schema.json
- request.v1.schema.json
- selection-failed.v1.schema.json
- selection-ok.v1.schema.json
- session.v1.schema.json
- surfaces.schema.json
- usage.v1.schema.json
