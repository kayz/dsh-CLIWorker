# Task 016 — 平台识别与本地 CLI 发现：WSL 跨发行版解析、拒读清单、增量清单

## 约束

以下命令供下游实现完成后在仓库根独立执行，使用 Node 20+ 和 PowerShell 7。本轮已授权 lib/exec.mjs 的 WSL 解码最小修改，禁止修改 lib/cli.mjs；命令模块导出 route={cmd:'discover',sub:null}。T-015 缺失使用 test/fixtures/discovery/ 下的本地 stub 补足，不是跳过或失败理由。真实规则未规定时按 design.md 的保守默认值判定，不再要求凭空补齐 11 个真实 CLI。当前 attention.json 仅记录工作树的带选项路由与用户所述注册表前提不符，不能将该接入缺口隐藏为验收通过。brief 未指定基准 commit SHA 或既有验收报告路径；用户引用的 e2fee30、275d393 为变更线索，不新增以 git 命令执行的基准检查。

每条命令的通过条件同时包括：原生命令退出码为 0、执行了对应 AC 的测试、所有下述断言通过。测试不存在、无匹配、跳过全部用例、测试进程报错均失败；不能仅打印 OK 或依赖其他命令的运行清单。run-tests 的实际稳定摘要为 `run-tests: filtered … files, manifest …`，省略号代表机器和测试数量变化，不要求测试标题全文。

## 建议验收方向

AC-036（integration）

命令：

```pwsh
node scripts/run-tests.mjs --ac AC-036
if ($LASTEXITCODE -ne 0) { throw 'AC-036 failed' }
```

期望输出：退出码 0，出现 filtered 运行摘要；测试报告失败数为 0，实际通过用例数大于 0。测试独立使用本地 stub，在合成 PATH、显式额外目录和覆盖路径布置 11 个受控候选及一个额外未知候选；候选名称和完整 expected 在测试夹具中独立写定，不能从实现规则表生成。对每条真实识别规则注明冻结契约的源文件，至少验证 inventory 合法示例支持的 claude --version；不把示例 C:/bin 当真实安装目录。规则未明确的候选按本轮裁决 recognized=false、version=null、auth.state=unknown、默认 exec=0，并以既有 evidence 字段给出 adapter_unverified 原因，不伪造能力或新增 reason/unverified 字段。每项 path、realpath、platform、evidence 正确，重复 PATH 或同目标链接不会重复建档。未知候选打开 --probe-unknown 后仅允许其 --version，recognized 仍为 false。覆盖配置 probe_unknown、额外目录及覆盖路径。通过真实 bin 分别验证 discover --config、discover --full --config、discover --probe-unknown --config 均能到达命令并输出单个 JSON，结果同状态文件一致；同时断言模块注册 route 的 cmd=discover、sub=null。通过当前 flow harness 运行 discover 步骤并确认成功及泄漏 0 命中。T-015 helper 不存在时上述测试仍须执行；11 个合成候选不得冒称 11 个已验证真实 CLI。上述断言编入本命令所匹配的集成测试，不依赖另外手工跑 CLI。

AC-037（unit）

命令：

```pwsh
node scripts/run-tests.mjs --ac AC-037
if ($LASTEXITCODE -ne 0) { throw 'AC-037 failed' }
```

期望输出：退出码 0，出现 filtered 运行摘要；失败数为 0，实际通过用例数大于 0。表驱动注入 win32、darwin、linux、Linux 上 WSL 环境/内核证据及缺失证据，不读取宿主真实 /proc/version。UTF-16LE 字节夹具覆盖有/无 BOM、CRLF、NUL、空行、默认标记、重复名称、空格和中文名称，解析结果与固定预期名称数组深相等。使用真实 createExec 配合注入的进程替身测试 ['-l','-q'] 的同步及异步路径，确认传到解析器的中文名称无损；异步把 UTF-16 字节切在码元内分段送达也必须正确，不能只把预先解码的文本交给解析器。另以普通 UTF-8 命令和相同可执行名的非列表 argv 做正向回归：stdout/stderr 和返回对象形状保持既有行为、spawn 的 shell=false，既有超时/并发/进程树/垫片路径不改。测试写在授权的 test/unit/discovery/ 内，不修改公共 exec 测试或 helper。两发行版中相同 CLI 分别得到 wsl:<d> 条目；每个实际 argv 与测试中独立声明的常量模板及位置参数深相等，含元字符的名称没有进入脚本文本。discovery.wsl=false 时 WSL 调用数为 0。不能以当前机器无 WSL 为由 skip。

AC-039（integration）

命令：

```pwsh
node scripts/run-tests.mjs --ac AC-039
if ($LASTEXITCODE -ne 0) { throw 'AC-039 failed' }
```

期望输出：退出码 0，出现 filtered 运行摘要；失败数为 0，实际通过用例数大于 0。同一独立夹具内完成首次扫描、TTL 内第二次扫描、删除、重新出现、指纹变化、TTL 到期和 --full；第二次本地扫描的条目探测 exec 数严格为 0，TTL 由 evidence.at 而非 last_seen 计算，持续扫描不能延长探测有效期；默认 TTL 取既有配置，测试使用注入时钟跨越边界。删除条目保留且 status=gone，last_seen 不刷新；重新出现恢复 present 并保持稳定身份。size、mtime、realpath 分别变化都触发重新探测；--full 对已知项重新执行，仍不擅自执行未知项。WSL 禁用/失败或目录访问失败不把该域条目误标 gone。每次保存的 inventory.json 均用 contracts/schemas/inventory.v1.schema.json 和已有校验器验证，不允许额外字段；写入失败时旧文件字节不变。所有状态在本命令中建立，不使用 AC-036 留下的文件。

AC-040（integration）

命令：

```pwsh
node scripts/run-tests.mjs --ac AC-040
if ($LASTEXITCODE -ne 0) { throw 'AC-040 failed' }
```

期望输出：退出码 0，出现 filtered 运行摘要；失败数为 0，实际通过用例数大于 0。使用本地 stub 注入独立、固定的合成拒读路径，构造直接候选、extra_dirs、override、点段、Windows 大小写/分隔符和允许路径链接到拒读目标的夹具；包括可执行垫片解析路径，不将合成路径称为冻结的生产清单。discover 全程对应目标的底层 ctx.fs 访问数严格为 0，拒读优先级高于显式目录和探测选项，正常相邻目录仍能扫描。同时覆盖生产拒读表缺省分支：按 design.md 的保守访问边界拒绝目录递归、未明确的安装/认证目录和非候选文件正文读取；规则不足的候选被保留为 unverified 证据且不执行。不能拿 contracts/agentline-forbidden.json 的输出禁用键充当秘密路径列表。对已有合法探测及其成功、失败、异常、超时输出注入原始输出与秘密哨兵；无契约依据的 status 不为凑测试而执行。evidence 恰含既有五字段，digest 正确且无 raw/stdout/stderr 新字段；既有 leakScan 对 stdout、stderr、state_dir、审计和 argv 得到 ok=true、hits=[]、errors=[]。必须有正常文件访问及实际探测作为正向对照，不能靠完全不扫描得到零计数。哨兵在测试运行时合成，不把真实秘密写入夹具或报告。

## 非目标

以上通过不代表 AC-038 的真机 WSL smoke 已通过，不覆盖 T-029 的发布职责。实现阶段还须按本机约定以 `pwsh -NoProfile -File scripts/check-fast.ps1` 完成仓库检查并检查退出码；其期望为退出码 0、最终出现 `check-fast: ok`。该检查会运行全仓库门禁及测试，可能产生运行产物或调用 git，因此本次仅允许创建指定文档的 design 阶段不执行；这不构成任何实现验收已通过的声明。
