# Task 020 验收标准

依据本任务 brief、design.md、本轮用户裁决与 contracts/spec/ac-index.json，仅登记 T-020 的 AC-047、AC-048。选择器与命令接线已获授权，T-018 构造接口已在工作树可读；770b609 是用户提供的 T-018 交付引用，并非本任务验收基准 SHA。brief 没有指定本任务基准或既有验收报告路径。本轮目录读取使用已有 listModels(config, {models: [], ctx})，不等待平行读取器。

T-015 仍未交付，本轮使用 test/fixtures/probe/** 的本地 stub 驱动交付。每条 AC 提供一个可执行的正式集成命令，执行真实生产入口与真实测试文件并打印 AC 哨兵。T-015 真实夹具缺失，因此通过只证明本地 stub 范围的集成回归，不能宣称真实供应商 CLI 或 T-015 集成已覆盖；两条追踪状态保持 planned，直到 T-015 接入并用其生成器与执行记录重跑原 AC。

各 pwsh 代码块是一条独立命令，从任意目录运行，不依赖另一条命令的产物。调度器可将代码块写入仓库外的 UTF-8 无 BOM .ps1 后用 pwsh -NoProfile -File 执行。每条检查原生命令退出码；只有正式命令可以打印 AC-nnn OK。报告和隔离测试数据使用系统临时目录，不读个人配置，不要求真实账号、真实供应商 CLI 或网络。

## AC-047

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\020'
node scripts/run-tests.mjs --ac AC-047; if ($LASTEXITCODE -ne 0) { throw "AC-047 failed" }; Write-Output "AC-047 OK"
```

- 期望输出：退出码 0；run-tests 输出 filtered 清单；fail、cancelled、skipped、todo 均为 0；最后一行为 AC-047 OK。
- 说明：该命令执行 test/integration/probe.test.mjs（含 [AC-047] 的 availability_stale 拒选、TTL 边界、同 provider 隔离、无探测记录兼容，以及生产 models select 命令从 probes.json 读取并拒选过期记录）与既有选择/适配器回归。T-015 真实夹具仍缺失，通过不表示真实供应商 CLI 已验证，追踪状态保持 planned。
- 行为断言：本轮由本地 stub、最终由 T-015 验证 ok→callable、auth→blocked/auth、quota→blocked/quota、timeout 和 enoent→unavailable、deprecated→deprecated、mismatch→identity=mismatch 且 blocked。持续 timeout 的 exec=2，其他已执行模式各 exec=1；配置预先弃用及未允许目标 exec=0，分别验证。timeout 后成功只重试一次，auth/quota/enoent 不重试。只调用 buildDirectCall，call=null 时复用既有 E_NO_CANDIDATE 拒绝且 exec=0；不依赖不存在的 parseEvent 导出，不把合成样本当作真实供应商证据。
- 行为断言：全部 evidence 既有键齐全；nonce_ok、reported_model、exit、duration_ms 与注入执行结果及 ctx.clock 一致。错误 nonce、缺失 nonce、缺失身份、坏事件、版本成功均不产生 callable；不能沿用旧成功证据掩盖失败。
- 行为断言：使用同一探测证据，在 TTL 内及恰好边界仍可用；伪时钟越过 probe_ttl_s 后，由真实生产选模以精确原因 availability_stale 拒选，模型和 call 不再生成；新鲜对照仍可选。读取不得刷新探测时间或执行推理，不得用测试自制选择器代替生产入口。
- 行为断言：同 provider 下一个模型过期、另一个新鲜时只拒前者。命令从 probes.json 读入逐模型记录；无文件、空记录、只有其他模型有记录、手工 evidence=null 这四种没有本模型探测记录的情况，候选顺序、身份、旧拒选原因、readonly、额度、forecast 次数和 call 均保持原语义；不得向请求或响应添加 probeModels 字段。
- 行为断言：真实 bin/cliworker.mjs 可达 models probe；目录读取复用既有 catalog 导出，不调用报错的 readCatalogModels 或新增平行读取器。新增 flow 步骤被实际执行，在同 state_dir 复读证据与账本且泄漏扫描通过，finally 恢复原配置与专属缓存，后续旧选择步骤保持原结果。本轮只能称为本地 stub 流程回归。所有期望均由 probe.test.mjs 的实际断言验证，不能只断言标题、schema 字符串或 helper 返回值。

## AC-048

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:\git\dsh-CLIWorker\.collab\worktrees\020'
node scripts/run-tests.mjs --ac AC-048; if ($LASTEXITCODE -ne 0) { throw "AC-048 failed" }; Write-Output "AC-048 OK"
```

- 期望输出：退出码 0；run-tests 输出 filtered 清单；fail、cancelled、skipped、todo 均为 0；最后一行为 AC-048 OK。
- 说明：该命令执行 test/integration/probe-ledger.test.mjs 的本地 stub 回归（时钟戳、TTL 内复用与过期重探、失败但已报告用量入账、首次超时后重试合并单行、幂等重放、损坏账本、池用量增量）。T-015 真实夹具仍缺失，通过不表示真实供应商 CLI 已验证，追踪状态保持 planned。
- 行为断言：只有白名单规范模型被执行，别名不重复探测；至少一个允许对照确实执行，未允许模型 exec=0、账本新增=0；空白名单也为零。
- 行为断言：每次实际逻辑探测仅追加一条完整 cliworker.usage/v1，kind=probe、idempotency_key=probe:<probe_id>，model 与 pools 真实对应。失败但已报告的用量仍计入；两次超时尝试归并同一行，不丢失已确认消耗。
- 行为断言：已知容量池的 used 增量等于按既有计费公式独立计算的探测用量除以模型容量，无关池不变，不直接改配置读数造成双计。覆盖读数截止时点与窗口范围。
- 行为断言：同 probe_id 的串行及并发提交重放返回原 id、只保留一行、used 不再增加，重放不执行推理；不同新 probe_id 分别计入。损坏账本与写入失败不能伪装成功。stdout/stderr、argv、模型 JSON、缓存和用量文件均不含假的密钥哨兵。
- 行为断言：T-020 追踪分片仅含本任务两条 AC，并准确指向两个实际测试文件；T-015 未接入时均为 planned，不因文件位于 integration 或本地命令成功而改 covered。完成真实 T-015 验证且正式命令全部成功后才能改 covered。测试不能通过改写 contracts、吞错、skip 或伪造报告满足验收，不增加新的追踪字段或版本。
