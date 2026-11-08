---
write_scope:
  - test/e2e/select-run.test.mjs
  - test/e2e/select-run-sequence.test.mjs
  - test/traceability/T-026.json
---

# Task 026 — 跨进程选模到执行的端到端（HTTP 与 CLI 两个入口，共享时钟文件，租约按位置递延）

## 目标

完成 T-026（M5）的 AC-064，层级为 e2e。通过真实插件 HTTP 选模入口与真实 CLI 选模入口取得包装 call，再启动独立 CLI 进程执行，证明租约、配置路径、工作目录、stdin 与文件时钟跨进程传递有效。design.md 规定实现，acceptance.md 规定独立验收命令；设计文档通过格式校验不代表实现通过。

依据 brief.md、.collab/blueprint/cliworker-v2/task-graph.json 的 T-026/AC-064、contracts/spec/ac-index.json，以及现有 contracts/schemas、contracts/registry.snapshot.json、contracts/host/dsh-host.v1.json。AC-064 的 baseline 沿用索引中的 darwin、linux、win32，不在追踪分片重写。brief 未给基准 commit SHA 或既有验收报告路径，不自行指定。

## 约束

顶部 write_scope 是下游实现可写的全部仓库路径，仅交付两个 e2e 文件与 T-026 追踪分片。设计角色本轮仅创建本任务的 design.md、acceptance.md。不修改 brief、任务状态、蓝图、其他任务、生产代码、契约、通用 helper、scripts 或 package.json，不执行 git 命令。发现既有实现缺陷时保留失败证据并报告，不改范围外实现、不跳过失败用例。

复用现有 cliworker.config/v2、cliworker.request/v1、cliworker.event/v1 与错误码。使用 Node 20+、ESM、node:test、内置断言及子进程 API，无第三方依赖，不新增命令、路由、公开字段或版本。lib/cli.mjs、lib/routes.mjs、lib/context.mjs 保持只读。

**进程与入口。** HTTP 用 test/helpers/host-stub.mjs 的 createHostStub 注册真实 createPlugin，传入实际配置路径和 createContext({env})；用 stub.request('/cliworker/select', {method:'POST', body:request}) 经过真实路由和选择实现，不能直接调用 runSelection 或注入恒定成功 handler。这里的 HTTP 指现有宿主契约请求链，不要求监听网络端口。宿主可在测试进程内，但执行端必须是另一个 OS 进程。CLI 选模用 process.execPath 启动 bin/cliworker.mjs models select --config <同一配置> --request <JSON>，选模进程退出后才启动执行进程；不调用 main 代替子进程，不在新进程中重新选模或手写租约。

请求显式给 schema:'cliworker.request/v1'、有效 level、request_id、count、usage、importance、require_readonly、cwd、timeout_ms；不带 view，避免进入 draft/full。两个入口每次使用不同 request_id，防止幂等重放遮蔽某一入口未实际选择。两个入口的参数比较在同一份配置、同一 state_dir 和固定选模时刻下完成；容量应足够容纳两次选择及全部保留量。除路径参数等稳定语义外，不要求随机 lease_id/handle_id、warnings 或完整响应逐字相等。

**隔离夹具。** 每个测试独立在 os.tmpdir() 下用 mkdtempSync 建立根目录，包含配置、state、home、clock、cwd、fake-cli 与调用记录；cwd 与配置路径至少包含空格，且执行 cwd 与仓库根、子进程启动者 cwd 不同。配置显式 state_dir，CLIWORKER_HOME 指向临时 home；继承必要系统环境时去除外部 CLIWORKER_*、NODE_TEST_CONTEXT，再设置本夹具变量。业务秘密只使用测试环境引用；不读取真实账号或系统密钥后端、不联网、不发现真实 provider。

沿用 test/integration/runner.test.mjs 与 test/flows/steps/run.mjs 的本地 fake-cli 模式：在允许的测试文件中保存小型脚本字符串，运行时写到临时目录，用 cli_overrides 的 cli:process.execPath、args_prefix:[fake脚本] 接入已确认的适配器。fake-cli 读完 stdin，记录 PID、argv、cwd、输入原文，并立即输出可被现有 runner 解析的 text、usage、result JSONL；使用固定文本和固定 token 数作为独立预期。通用 test/helpers/fake-cli.mjs 的普通 ok 模式只输出 ok，不能直接作为要求 usage 的 run 成功夹具；不修改该 helper。禁止 fake-cli 使用 sleep/延迟来制造租约时间。

配置与 probes.json 按现有 runner 夹具构造：可选、已允许、已验证、callable、支持 readonly/stdin 的模型及足额池；count=3 至少准备三个候选。可用性 TTL、池窗口和容量覆盖整段虚拟时间，避免非目标的探测过期、额度耗尽或窗口重置影响验收。选择结束后不再修改配置、探测、租约文件；允许更新共享时钟文件。不能直接调用 buildCall/expiresAtFor 生成测试期望。

**共享时钟与生命周期。** 所有业务时间用同一个固定初值的 UTF-8 无 BOM 时钟文件，插件 ctx 与每个 CLI 子进程的 env 均带绝对 CLIWORKER_TEST_CLOCK_FILE。selected_at 是测试写入文件的选模时刻，不增加响应字段；可以只读 leases.json 核对持久化的 selected_at。每次写入完成后才启动对应进程，执行期间文件保持不变，并断言每个 event.at 等于该次文件时间。禁止用 Date.now()、无参 new Date()、墙钟 sleep 或超时竞速推断租约状态。子进程必须有有限的失败保护超时、windowsHide:true、shell:false；这是挂起保护，不是租约计时。优先等待进程正常退出后读取已完成的记录，免去轮询；确需轮询时用有限次数/伪时钟推进且明确失败，不无界等待。

用 finally 或 t.after 清理整个临时根，构建夹具中途抛错也能清理；先结束所有已启动进程再删除目录。删除目标须为本测试创建的临时根，不允许清理用户目录或仓库。测试结束后断言临时根不再存在，确保 state_dir 与时钟文件同时清除。测试文件之间不共享可变状态或运行顺序，不产生仓库内报告或夹具文件。

## 建议验收方向

**test/e2e/select-run.test.mjs。** 用 HTTP 与 CLI 分别完成以下真实链路，每个核心用例标题带 [AC-064]，验收按进程输出和文件状态断言，不依赖标题文字：

1. 选择成功：HTTP 状态 200；CLI status=0、无 signal/error。JSON 响应 ok=true，models 与 calls 各含一个元素，calls[0] 与 models[0].call 深相等，--lease 指向对应 model 的 lease_id。
2. 比较两个入口返回的 --config、--state-dir：各恰好出现一次且有值，值为夹具预先确定的配置和 state 绝对路径，并相互相同。不能只比较二者相等而不比较独立预期；不能执行前补参、替换路径或把整串命令交给 shell。
3. 原样执行所取得的 call：spawnSync(call.command, call.args, {cwd:call.cwd, input:测试输入, env:夹具env, shell:false, windowsHide:true, timeout:有限上限})，或等价的异步 spawn。call.input='stdin' 是输入通道声明，不是正文；使用含中文、多行及尾随空格的固定文本写入 stdin 并关闭输入，不能 trim 或加换行。不新增 call.stdin 字段。保持 command、args 顺序与 cwd 不变；timeout 使用返回的 call.timeout_ms 或明确的外层挂起保护，不改写 call。
4. 新进程 status=0，stderr 为空。stdout 每个非空物理行独立 JSON.parse，并使用 lib/contract/validate.mjs 的 validate 对只读 event.v1.schema.json 校验，所有结果 ok=true、errors=[]。seq 从 1 连续递增，lease_id 与选择结果一致，at 等于共享时钟；首事件 start，终事件唯一 result，result.ok=true、exit_code=0、text 与 usage 等于 fake-cli 固定值，无 error 事件。不能只检查 schema 字符串或末行的 ok。
5. fake-cli 恰好执行一次，记录的 PID 与测试进程不同，cwd 等于 request.cwd/call.cwd，stdin 逐字等于输入，argv 等于夹具适配器已知模板。由 process.execPath 与临时脚本路径推导预期，禁止写死安装路径。本任务用 Node 脚本避免依赖原生垫片；涉及 cmd/pwsh 平台差异的附加 argv 断言，使用现有 test/helpers/platform-gate.mjs 的 satisfies 选择适用分支，不把核心测试注册为平台跳过；核心端到端用例三平台均执行，不因缺少 pwsh/真实 CLI 而 skip。
6. 在同一有效时刻、同一配置下，再启动一个进程执行同一原始 call 和相同输入。终事件为 E_LEASE_CONSUMED，进程退出码与终事件 exit_code 均等于现有注册表（当前为 6），retryable=false，无成功 result。所有错误流事件同样通过 event/v1 校验。fake-cli 调用记录仍为一次；usage.jsonl 对该 lease 的 :post 恰一条，重放前后账本字节相同。不得在租约过期后测重放，否则过期检查会先返回 E_LEASE_EXPIRED。

**test/e2e/select-run-sequence.test.mjs。** HTTP 与 CLI 两个入口均覆盖 count=3 的有效序列与独立过期组。每组使用新建夹具或未被消费的新选择批次；不能复用成功执行过的租约来代替过期场景。

- 选模时记录固定 selected_at（毫秒），明确配置 lease_ttl_s 和请求 timeout_ms，timeout_ms > 1000。断言 models.length=calls.length=3，三个 lease_id 互异，逐项 call 与 handle 对齐。独立计算每个 models[i].expires_at = ISO(selected_at + lease_ttl_s*1000 + i*timeout_ms)，i 从 0 起，不能只断言三个时间递增。brief 中 timeout_s 即 timeout_ms/1000，calls[i] 没有 expires_at，引用与它对应的 models[i].expires_at，不新增字段。
- 对 i=0、1、2，依次把同一时钟文件写成 selected_at + lease_ttl_s*1000 + i*timeout_ms - 1000，再以 calls[i] 的原始 command/args/cwd 启动独立进程并传 stdin。三个进程均返回经 schema 校验的成功流及固定 result；事件 at 必须等于本步写入时刻。后两个执行时刻已越过第一个租约的截止时间，仍应成功，这一事实必须明确断言，避免三个租约统一使用首个 TTL 的实现误通过。
- 每步 fake-cli 调用数增加 1，三步的记录分别保留对应输入/cwd/argv；每个 lease 有且只有一条 :post 账本记录。全部执行完前不得重新选模或刷新租约。
- 另一独立组在选模后不执行任何 call，把时钟写成 Date.parse(models[2].expires_at)+1000，执行原始 calls[2]。终事件 code=E_LEASE_EXPIRED、retryable=true，进程与事件退出码等于注册表（当前为 6），无成功 result；整个流通过 event/v1 校验且 at 为该时刻。fake-cli 调用数为 0，未产生该 lease 的 :pre/:post 账本行。不得通过删除租约、修改配置或模拟错误来制造拒绝。

**追踪与门禁。** test/traceability/T-026.json 沿用现有 {task,milestone,entries:[{ac,files,status}]} 形状，task='T-026'、milestone='M5'，仅登记 AC-064、上述两个测试文件、status='covered'；不添加 baseline、schema 或其他字段。两个文件均需实际带 [AC-064] 测试，不修改其他分片与索引。

acceptance.md 在唯一的 AC-064 小节中分别提供两个 e2e 文件、追踪、unit 回归、文档格式与 check-fast 命令及期望输出。每条命令独立设置 cwd、检查退出码，仅成功后打印 AC-064 OK。e2e 必须实际执行且 fail/cancelled/skipped/todo 均为 0；unit 保留既有平台门控，不把合法跳过当新增覆盖。下游完成实现后执行全部命令，包括 node --test "test/unit/*.test.mjs" 与 pwsh -NoProfile -File scripts/check-fast.ps1。

本设计阶段只做只读静态核对、文档格式与 UTF-8/范围核对；不运行会生成结果文件、包产物或内部调用 git 的测试/完整门禁。以上门禁交由下游有相应执行范围的角色运行，不能把本轮格式自检称为 e2e 或回归已通过。

## 非目标

不修复产品实现、不新增命令/路由、不增加单测或单进程集成测试、不改契约/公开字段；不覆盖真实 provider、账号、性能、安装升级、冒烟或发布门禁。测试仅证明既有选模与执行入口在规定夹具和平台基线下衔接正确。

