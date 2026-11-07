正在根据上一轮产物和 review-v2 的 8 条意见（F-01..F-08）出第三轮修订设计。本轮只读，没有改动任何文件。

# CLIWorker v2 设计稿（第三轮修订，设计师，只读）

本轮没有修改、创建或删除任何文件。我重新读了上一轮的 `design.md`、`interfaces.md`、`task-graph.json`、`risks.md`、`testability.json` 和 `review-v2.verdict.json`，在第二轮设计上做定点修订。第二轮里没有被评审否定的部分（F-09 已确认）保持不变，下文只完整重述有改动的章节。

## 0. 本轮结论

1. **时钟可以推进，并在 M1 定死（F-01）。**
   - `ctx.clock` 提供 `now()`、`setTimeout`、`clearTimeout`、`sleep`。
   - 测试用的伪时钟另外暴露 `setNow(t)`、`advance(ms)`、`pending()`。`advance` 按到期顺序触发定时器，每触发一个就让出一次微任务。
   - 生产代码只能通过 `ctx.clock` 取时间、设定时器。`check-seams` 把限制扩到全局 `setTimeout`、`setInterval`、`setImmediate` 和 `node:timers`，它们都只允许出现在 `lib/context.mjs`。
   - 跨进程场景用环境变量 `CLIWORKER_TEST_CLOCK_FILE`：子进程每次调用 `now()` 都重新读这个文件。只要设置了该变量，CLI 每次输出都带 `W_TEST_CLOCK`，health 也会报告。
   - 新增 AC-072。
2. **权威规格放进仓库（F-02）。**
   - `contracts/registry.snapshot.json` 自包含：码、触发条件、退出码、HTTP 状态、阈值表、拒选原因、draft 映射、semantic_change 都在里面。
   - `contracts/spec/` 放 AC 索引、保留面与语义变更面、迁移映射；`contracts/golden/` 放全部金标。
   - 这些文件都由 T-004 在 M1 写入并提交，实现任务只读不写。
   - `docs/contract.md` 由脚本从规格生成。`check-no-collab` 禁止仓库里任何代码、测试、文档引用 `.collab`。
   - 新增 AC-073。
3. **原生专属 AC 有了明确的通过来源（F-03）。**
   - baseline 取值扩成 `linux / win32 / darwin / real-smoke`。
   - AC-038 改为 smoke 层，baseline 为 `real-smoke`，由 smoke 报告里的 `wsl-discover` 步骤通过 `ac` 字段计入。
   - 豁免只认仓库内 `release/waivers.json` 的显式条目，只适用于 baseline 为 real-smoke 的 AC，单列报告，不算通过。
   - AC-027 的测试自己在临时目录生成 `.cmd` 垫片，不依赖 runner 上装了什么。
4. **特征化只冻结 0.1 副本（F-04）。**
   - 冻结对象是 `test/fixtures/characterization/v0.1/` 下取自提交 f75bb76 的库副本，以及 `stable.test.mjs`。
   - `check-frozen-files` 遇到清单中有任何路径不在这两处时直接失败，所以 live 的 `lib/` 永远不会被哈希。
   - 保留面和语义变更面在 `contracts/spec/surfaces.json` 里列明。
5. **缺陷按所属里程碑翻转（F-05）。**
   - M1 的标题改了。每条缺陷记录归属任务和归属里程碑。
   - 缺陷文件分成两部分：`[repro]` 针对 0.1 副本，永远运行；`[fixed]` 针对 live lib，由归属任务补上。
   - `milestone-gate --milestone Mx` 只校验 Mx 及以前的 AC 和缺陷。A 节全部翻转的判定点是 M5。
   - 新增 AC-074。
6. **追踪合并有了唯一规则（F-06）。**
   - AC 索引只有一份（`contracts/spec/ac-index.json`），记录每条 AC 的唯一属主任务、层级和 baseline，baseline 只在这里声明。
   - 分片只能列属主是自己的 AC。同一条 AC 出现在两个分片、或出现在非属主分片，都失败。没有分片的 AC 视为 planned。
   - 发现校验只在完整运行时做集合相等比较，`--ac` 过滤运行只写 `mode:'filtered'` 的清单。
   - T-030 直接依赖所有产出流程步骤的任务。
7. **管理会话可以自举（F-07）。**
   - `GET /cliworker/api/session` 和 `GET /cliworker/ui`（不含数据的静态外壳）是路由表里显式列出的例外：不要求会话，只校验 loopback，失败返回 `E_LOOPBACK_ONLY`。
   - session 响应同时返回 `session` 和 `csrf`。csrf 是进程密钥对会话 id 做的 HMAC，所以首个写请求使用同一次响应拿到的两个值即可。
8. **每个触发条件只对应一个错误码（F-08）。**
   - 注册表里每个码带唯一的 `trigger_id`，403 类五个码的触发条件互斥，判定顺序固定。
   - AC-059 改为逐条路由只有一个预期码的表格。
   - HTTP 响应和 CLI 输出共用 `lib/contract/scan.mjs`。

## 1. 评审意见处理

| 编号 | 处理 | 落点 |
|---|---|---|
| F-01 | 可推进时钟、定时器统一走 ctx、跨进程时钟文件 | T-003、AC-007、AC-072；AC-019/028/029/047/049/058/064 改用 advance 或 setNow |
| F-02 | 规格与金标入库，snapshot 自包含，禁止引用 `.collab` | T-004、AC-073；AC-015/016/017/051 改为读 `contracts/golden` |
| F-03 | 新增 real-smoke 基线，smoke 步骤带 ac 映射，引入豁免文件；AC-038 归 T-029；AC-027 自建垫片 | AC-038、AC-069、AC-070、AC-027 |
| F-04 | 只冻结 0.1 副本；保留面与语义变更面分开 | T-002、AC-005 |
| F-05 | M1 改名；缺陷账本加归属里程碑；新增 milestone-gate | T-001、T-002、AC-074 |
| F-06 | 单一 AC 索引加属主分片；只在完整运行做发现校验；T-030 依赖补齐 | AC-001、AC-004、T-030 |
| F-07 | session 和 ui 外壳列为例外；csrf 随会话签发；判定顺序固定 | T-024、AC-059、AC-060 |
| F-08 | 每个码有唯一 `trigger_id`，新增 `E_LOOPBACK_ONLY` | T-004、AC-009、AC-059 |
| F-09 | 已确认，保持不变 | 第 2 节 |

## 2. 现状勘误（沿用上一轮，未改）

1. `lib/config.mjs:19` 的 TypeError 来自抛错模板字面量里对 `raw.schema` 的插值。第 19～21 行的 throw 都没有设 `error.code`。
2. `.gitignore` 只有 3 条字面规则。本轮改为 `config/*.local.json`、`state/`、`*.jsonl`、`.collab/`。
3. `run --lease`、`cli resolve`、包装调用都是新功能，不按回归处理。
4. `config/cliworker.local.json` 没有被 git 跟踪，不删除；加载时返回 `E_CONFIG_EXAMPLE`。
5. `select.mjs` 有三个 forecast 调用点，其中一个在排序比较器里；改为按模型记忆化。

## 3. 可注入缝与时钟（T-003，M1）

**`lib/context.mjs` 的 `createContext(overrides)` 提供：**
- `exec`、`fs`、`fetch`、`env`、`platform`、`stdout`、`stderr`、`clock`、`random`。
- `ctx.now()` 只是 `ctx.clock.now()` 的别名。

**真实时钟：**
- 用 `Date.now` 和全局定时器实现。
- 如果设置了 `CLIWORKER_TEST_CLOCK_FILE`，`now()` 每次调用都读这个文件（毫秒数或 ISO 时间），定时器仍用真实时间；同时 `main()` 在每个输出里追加 `W_TEST_CLOCK`。

**伪时钟（`test/helpers/clock.mjs`，由 `ctx.mjs` 组合）：**
- `setNow(t)` 和 `advance(ms)`：按到期时间、相同时按注册顺序触发定时器；`advance` 返回 Promise，每个回调之后等一轮微任务。
- `sleep(ms)` 登记一个定时器，所以等锁这类循环只有在测试推进时钟时才前进。
- `pending()` 返回待触发的定时器数量。

**哪些 AC 用哪种时间手段：**

| AC | 手段 |
|---|---|
| AC-019、AC-047、AC-049、AC-058 | 同一测试内用 `setNow` 跨过阈值 |
| AC-029 | 用 `advance` 推过 `lock_wait_ms` 和 `lock_stale_ms`，断言虚拟耗时和重试次数 |
| AC-028 | 等屏障文件出现（孙进程 pid 已写出）后，`advance(timeout_ms)`，断言 `E_TIMEOUT` 和进程树被杀；只轮询进程是否已死，不断言墙钟 |
| AC-064 | 测试改写时钟文件，子进程读同一时钟 |

**宿主契约与上下文契约分开：** `contracts/host/dsh-host.v1.json` 只描述 DSH 宿主；`contracts/context/context.v1.json` 描述 ctx 的接口面（包括 clock）。

**`check-seams` 的规则：**
- 只有 `lib/exec.mjs` 可以导入 `node:child_process`。
- 只有 `lib/context.mjs`、`lib/store.mjs`、`lib/fsx.mjs` 可以导入 `node:fs`。
- 只有 `lib/context.mjs` 可以出现不带参数的 `Date.now`、`new Date`，以及全局 `setTimeout`、`setInterval`、`setImmediate` 和 `node:timers`。
- 每条规则都有违规自测夹具。

## 4. 仓库内的权威规格（T-004，M1）

| 文件 | 内容 | 被谁用作预期值 |
|---|---|---|
| `contracts/registry.snapshot.json` | 每个码的 code、exit、http_status、retryable、trigger_id、trigger；警告码；v1 和 draft 拒选原因及映射；forecast reason；risk 与 basis 枚举；两张阈值表和优先级；可用性和 identity 枚举；semantic_change 列表；snapshot_version | AC-009、AC-010、AC-067 |
| `contracts/spec/ac-index.json`（由 T-001 写入） | AC-001..AC-074 的属主任务、里程碑、层级、baseline | AC-004、AC-070、AC-074 |
| `contracts/spec/surfaces.json` | 保留面和预期语义变更面 | AC-005、AC-067 |
| `contracts/spec/migration-map.json` | draft 到 v1 的原因与字段映射；config v1 到 v2 的映射 | AC-034、AC-067 |
| `contracts/golden/quota-shapes.json` | 四种额度形状 | AC-015 |
| `contracts/golden/b44.json` | 需求 B.4.4 的 opus 2M / sonnet 10M 例子 | AC-016 |
| `contracts/golden/forecast/*.json` | 阈值边界、分位数、置信度、burn、eta | AC-017 |
| `contracts/golden/policy/*.json` | P1～P4 | AC-051 |
| `contracts/golden/capacity.json` | 容量学习 | AC-050 |

补充规则：
- `docs/contract.md` 由 `scripts/gen-contract-doc.mjs` 从上述文件生成；`check-contract-doc` 断言重新生成的结果与已提交的版本逐字节一致。
- 运行时只读随包发布的 `contracts/registry.snapshot.json`、`contracts/schemas`、`contracts/agentline-forbidden.json`；`contracts/golden` 和 `contracts/spec` 不进包。
- `scripts/check-no-collab.mjs` 扫描 `lib`、`scripts`、`test`、`contracts`、`docs`、`package.json`，出现 `.collab` 即失败。
- 金标由 T-004 一次写定，后续任务的 write_scope 不包含 `contracts/golden`。要改金标只能走蓝图变更，并递增 snapshot_version。

## 5. 特征化与缺陷账本（T-002，M1）

**0.1 副本：**
- `test/fixtures/characterization/v0.1/` 是提交 f75bb76 的 `lib/*`、`config/cliworker.example.json` 的逐字节副本，只用于对照，不被生产代码引用。
- `frozen-files.json` 记录源提交号和每个文件的 sha256。
- `check-frozen-files` 在两种情况下失败：哈希变了；或者清单里有任何路径既不在该副本目录下，也不是 `test/characterization/stable.test.mjs`。

**保留面（`stable.test.mjs` 只 import 副本）：**
- 弃用和未验证的模型不进候选。
- 等级过滤。
- exclude 的原因。
- 四个 schema 名字符串。

**预期语义变更面（不在冻结范围内，由各自任务的金标负责）：**
- forecast 新增 `tasks_left_basis`、`risk_basis`，`tasks_left` 改为允许 null。
- handle 去掉 `cli` 键。
- draft 到 v1 的原因映射。
- config v1 到 v2。

**缺陷账本 `test/characterization/defects.json`：**
- 11 条，每条为 `{id, owner_task, owner_milestone, ac}`。
- M1：a1-quota（T-006/T-007）、a2-pack（T-009）、a3-runner（T-001）、a4-paths、a4-null-config（T-005）、a5-dup-call、a5-forecast-x3、a5-unused（T-007）、a5-ignored-fields（T-008）。
- M2：a5-shell（T-010）。
- M4：a5-nocache（T-022）。

**缺陷文件与检查：**
- 每个缺陷文件的 `[repro]` 部分针对副本断言缺陷存在，永远运行、永远应当通过。
- `[fixed]` 部分针对 live lib 断言修复后的行为，由归属任务补写。
- `check-defects` 默认只要求属主分片已为 covered 的缺陷具备 `[fixed]` 部分，所以不会提前误报。
- `--milestone Mx` 时要求 owner_milestone ≤ Mx 的缺陷全部具备 `[fixed]` 部分；M5 时要求 11 条全部具备。

## 6. 测试设施、追踪与门禁（T-001、T-030）

**运行器：**
- `run-tests` 完整运行时写 `files-executed.json`，`mode:'full'`，并在当场与枚举集合做集合相等比较，不相等就失败。
- `--ac` 过滤运行只写 `mode:'filtered'` 的清单，不做比较。
- `check-test-discovery` 只是对这套逻辑的自测，用夹具证明它能检出不一致，并且过滤清单不能顶替完整运行。

**追踪：**
- 合并规则见第 0 节第 6 条。
- 每条 AC 的层级必须与 baseline 相容：unit、contract、integration、e2e 只能取 linux、win32、darwin；smoke 只能取 linux（dry-run）或 real-smoke。

**里程碑门 `milestone-gate --milestone Mx`：**
- 属主任务在 Mx 及以前的 AC 全部 covered，并且在完整运行中通过。
- `check-defects --milestone Mx` 通过。
- 不校验更晚里程碑的 AC，所以 M1 不会因为 AC-026、AC-055 失败。

**发布门禁 `release-gate`：**
- 每条 AC 的 baseline 都来自 ac-index。
- CI 基线：对应 OS 的 runner 上，任一 Node 版本至少有一次 pass。
- real-smoke 基线：只认 `mode:'real'`、`redacted:true`、版本等于 package 版本的 smoke 报告；报告中声明了该 AC 的步骤为 pass 才算数。dry-run 报告永远不能满足 real-smoke。
- 豁免：`release/waivers.json` 每条为 `{ac, reason, approved_by, version}`，只适用于 baseline 为 real-smoke 的 AC，version 必须等于当前版本，在报告中单独列为 waived。
- skip 永远不算 pass；有 planned 或 fail 就阻断；mandatory 的 smoke 步骤为 skip 也阻断。

**原生专属 AC：**

| AC | 基线 | 通过来源 |
|---|---|---|
| AC-027 | win32 | Windows runner，测试自己在临时目录生成垫片 |
| AC-038 | real-smoke | 维护者在装有 WSL 的 Windows 真机上运行 real smoke 的 `wsl-discover` 步骤 |

AC-033 的原生密钥后端只是附加用例，它的 baseline 是 linux 上的纯单测。

## 7. 边界与路由（T-024）

**AgentLine 能接触的内容（与上一轮相同）：**
- 请求：`level`、`count`、`usage`、`importance`、`require_readonly`、`cwd`、`timeout_ms`、`request_id`、`exclude_handles`。
- 响应：不透明的 `handle_id`、`lease_id`、包装后的 `call`、`rejected` 中的不透明引用和原因码、错误码。

**HTTP 路由表：**

| 路由 | 级别 | 判定 |
|---|---|---|
| `POST /cliworker/select` | AgentLine | 不需要会话；请求带 `view:'full'` 或 `compat:'draft'`，而没有有效会话时返回 403 `E_VIEW_FORBIDDEN` |
| `GET /cliworker/api/session` | 自举例外 | 不需要会话；loopback 校验失败返回 403 `E_LOOPBACK_ONLY` |
| `GET /cliworker/ui` | 自举例外 | 同上，只返回静态外壳，不含任何数据 |
| `GET /cliworker/health` | 公共 | 不需要会话，只输出状态 |
| 其余 `GET /cliworker/providers`、`/models`、`/forecast`、`/api/*` | 管理读 | 没有有效会话返回 403 `E_ADMIN_REQUIRED` |
| `POST /cliworker/api/*`（session 除外） | 管理写 | 按下面的顺序判定 |

**loopback 校验：** 必须同时满足三条——socket 远端地址属于 127.0.0.1、::1、::ffff:127.0.0.1；Host 的主机名属于 localhost、127.0.0.1、[::1]（防 DNS 重绑定）；Origin 不存在，或也是 loopback。

**会话：**
- session 响应为 `cliworker.session/v1`，含 `session`、`csrf`、`expires_at`。
- session id 是 32 字节随机数，`csrf = base64url(HMAC-SHA256(进程密钥, session id))`。
- TTL 取 `policy.session_ttl_s`，默认 43200 秒；只保存在内存中，进程重启后全部失效。
- 只走请求头，不用 cookie。

**写接口的判定顺序：**
1. 会话无效：`E_ADMIN_REQUIRED`。
2. 插件为 readonly：`E_READONLY`。
3. csrf 缺失或不匹配：`E_CSRF`。
4. 请求体不合法：`E_REQUEST_INVALID`。

**CLI：**
- `models select` 带 `view:'full'` 时返回 `E_VIEW_FORBIDDEN`；完整视图只由 `admin select` 提供。
- CLI 的 draft（没有 schema 或带 `compat:'draft'`）照常允许，并带 `W_DRAFT_DEPRECATED`。
- HTTP 上没有 schema 也视为 draft，所以同样需要会话。
- HTTP 响应和 CLI 输出都由 `lib/contract/scan.mjs` 检查。

## 8. 其余章节（沿用第二轮，不改）

以下内容沿用第二轮设计，接口细节见 JSON 的 interfaces 字段：
- Provider 层：平台识别、WSL 跨发行版、扫描范围、识别规则表、未知 CLI、拒读清单、增量清单、安全执行、按 CLI 枚举模型并回退到手工补录、适配器、真实探测。
- 模型目录：白名单是唯一入口，等级来源优先级为 config > measured > cli，别名与弃用。
- 额度与预测公式：T-006 在 M1 定稿为纯函数，金标在 `contracts/golden`。
- 选模策略：A 类（计划内、按紧迫度）、B 类（未知）、C 类（付费兜底），以及储备、truncated、`E_INSUFFICIENT_QUOTA` 与 `E_NO_CANDIDATE` 的判定、租约。
- 执行器与跨进程：`expires_at_i = selected_at + lease_ttl_s + i × timeout_s`。
- 密钥：SecretRef，只经环境变量注入。
- 界面：六列，每 15 秒拉一次 snapshot，异步 job，unknown 与 stale 的显示规则。
- 可靠性：原子写、锁、启动回收、备份与回滚。

## 9. 待用户确认

1. real smoke 需要维护者在装有 WSL 的 Windows 真机上运行（例如 keel 这台机器）。没有这台机器时，只能通过 `release/waivers.json` 显式豁免 AC-038。
2. 冷门 CLI 在真机采集参数形态之前，一律按 `adapter_unverified` 处理，不可选。
3. 每池容量由用户在配置里给出，或通过读数学习，不内置厂商数字。
4. 管理会话只信任 loopback；如果 DSH 宿主在反向代理后面，需要宿主提供自己的鉴权。

## 10. 决策锚点（Studio 纪要固化）

### 10.1 身份证据对象（D-1）

统一证据对象字段固定为 requested_model、reported_model、selected_model、source、strength、observed_at。

- source ∈ {stream-json, stats.models, event.model, rollout-file, cli-flag, none}
- strength ∈ {verified, asserted, unknown}

规则：asserted 可参与所有角色，结果标 provisional；调用失败或身份冲突即切换候选并完整审计；unknown 不得静默通过。AgentLine 不再对「未提供身份」重复硬判，只消费该对象与 calls[]。

### 10.2 估计刷新（D-7）

reset_at 来自估算时只触发复核（recheck），不得直接把 used_fraction 清零；只有 CLI 上报并确认的 reset_at 越过之后才清零。

### 10.3 Top 档兜底（D-8）

Top 档池必须至少含一个非 claude 供应商的候选；选模优先控制 claude 配额消耗，仅在池内耗尽并给出 E_TIER_EXHAUSTED 时才申请跨档授权（allow_downgrade=true），授权记录进审计。


## 11. 身份证据契约（身份归 CLIWorker）

AgentLine 已回退 `modelResolved || model` 的伪造兜底，并确认：身份判定不再由控制面各自实现，统一归 CLIWorker。本节是 CLIWorker 侧必须提供的契约。

### 11.1 身份等级（固定枚举）

| 等级 | 含义 | 是否阻断调用 |
|---|---|---|
| `verified` | 本次调用的 stdout 结构里直接证明实际模型 | 否 |
| `observed` | 旁路证据（rollout 文件、统计表、CLI 自报日志）可推断实际模型 | 否 |
| `unverified` | 无任何证据；只记录了请求模型 | **否** |
| `failed` | 调用本身失败（超时、认证、限流、非零退出） | 是（触发候选降级） |

### 11.2 ModelHandle 的 identity 对象

```json
{
  "identity": {
    "level": "verified | observed | unverified | failed",
    "identity_source": "stdout.modelUsage | stdout.event.model | stats.models | rollout-file | cli_flag | none",
    "evidence": { "path": "...", "at": "...", "detail": "..." },
    "requested_model": "...",
    "reported_model": "..." 
  }
}
```

- `unverified` 必须照常返回可调用的 handle，不得因为缺少证据而拒绝。
- `evidence` 里不得出现令牌、路径中的用户名等敏感信息（经 redact）。
- codex 的 `~/.codex/sessions/.../rollout-*.jsonl` 只能记为 `observed` + `identity_source: rollout-file`，永不冒充 `stdout` 证据。
- gemini 的 `stats.models`、claude 的 `modelUsage`、codebuddy 的 `event.model` 记为 `verified`。

### 11.3 calls[] 的证据

每次调用返回：`requested_model`、`reported_model`、`identity.level`、`identity_source`、`evidence`、`exit_code`、`latency_ms`、`tokens_in/out`、`outcome`（`ok | failed`）。

### 11.4 与上层的分工

- CLIWorker：判定等级、产出证据、在 `failed` 时给出可切换的候选（`exclude` 语义）。
- AgentLine：只消费 `identity` 与 `calls[]`，不再解析各 CLI 的 stdout，不因 `unverified` 拒绝，只在 `failed` 时降级。


## 12. 界面需求补充：问题优先页

模型管理界面的**第一个标签页**是「问题」。CLI 在处理任务时自报的问题必须出现在这里，而不是只沉到日志里。

- 覆盖范围：阻塞、权限被拒（工具不可用）、工具失败、契约不满足、额度不足、session 恢复失败、以及“模型自报无法完成但流程仍在继续”的情形。
- 每条问题的最小字段：任务 ID、角色、模型与 provider、发生时间、错误码或分类、一句话摘要、详情（原始输出片段 + 证据路径 + 建议动作）。
- 并发场景：多个任务同时进行时，按严重度（blocking > major > minor）与时间倒序排列；支持按任务、角色、严重度筛选；同一任务同类问题合并计数，不重复刷屏。
- 实时性：沿用 SSE，状态文件变化后 5 秒内上屏；详情可直接跳到对应任务的 `sessions/` 与 `logs/` 证据。
- 「未闭环」标记：模型自报无法完成、但 flow 继续往下走的情况，必须在问题页持续可见并标红，不因流程继续而消失。这是本次事故（dev 删不掉文件但仍然“完成”）的直接教训。
