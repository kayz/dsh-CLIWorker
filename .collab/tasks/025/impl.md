本轮依据评审补充了 UI fixture 和可按 AC 筛选的测试，验证六列的来源与时间、真实 0 和 100%、问题的严重度排序与组合筛选、详情和未闭环保留；新增含模型、实测证据与额度的真实入口快照测试，验证失败后保留旧值和观测时间、后续成功读取新值，以及已有 JSON handler 的覆盖顺序。另验证 readonly、作业路由注册失败、网络失败不重放写请求、资源路径绕过及脱敏样本。

实现上拒绝 URL 规范化前的编码和反斜线路径，并检查原始路径与注册路径一致；读取失败时在状态中显示尝试时间；无实测证据时不将 callable 显示为已确认；余量百分比按一位小数舍入（0.29 显示为 29%），避免 `28.999999999999996%` 之类浮点噪声。同一实例的作业按接受顺序执行，并在运行前读取历史视图，避免旧作业后完成覆盖新作业。添加 `test/traceability/T-025.json`，AC-062 和 AC-063 登记为 covered；AC-077 不在 `contracts/spec/ac-index.json` 中，仍只按本任务 acceptance/design 的有限范围验收，不伪造未登记的追踪。

集成测试补足了会话令牌边界：令牌只在 session 签发响应中可读，正常/失败快照、job、错误和 UI 资源响应均不含 session/csrf 与秘密哨兵；会话过期后旧 session 头直接请求快照得到 403 `E_ADMIN_REQUIRED`（不再只靠请求序列推断）。

自测（串行独立执行，全部为直接退出码）：两个指定测试文件组合运行 13 项通过；`node scripts/run-tests.mjs --ac AC-062`（4 项）、`--ac AC-063`（9 项）、`--ac AC-077`（13 项）均退出 0；`node --test test/unit/*.test.mjs` 退出 0（485 项通过、0 失败、0 跳过）；验收文档格式检查退出 0（acs=3 commands=5，warnings=0）；追踪检查退出 0（covered=66 planned=9）。`node scripts/check-fast.mjs` 退出 1：`check-pack.mjs` 本次通过，但全量测试仍有两条 T-024 旧用例失败——`plugin-guard.test.mjs:162` 仍期待 discover 同步返回 `cliworker.inventory/v1`，`plugin-routes.test.mjs:29` 仍期待无 UI 文件的 fakeFs 下 `/cliworker/ui` 为 200；前者与本任务 job_id 异步契约冲突，后者与真实 ctx.fs 静态资源服务冲突，design 已把这列为已知旧回归，未改范围外测试、未返回伪造外壳迁就。其余 check-* 步骤通过。

仍未完成全部规格：作业失败仍按整份上次成功快照标 stale，未实现受影响项隔离（其他项不会被清空，但失败项与未受影响项没有分别标记）；余量 stale 目前借用可用性探测的 `availability.at/ttl_s`，没有探测证据时即使池读数新鲜也可能保守显示 stale（评审第 2 轮 F5，作为已知限制保留，未改 forecast 时间语义）；同一实例作业已验证串行，其他实例或外部进程写入的竞争未验证；问题来源仍未接入，页面上的问题筛选和详情交互尚未接线；连续轮询只断言 `clock.pending()===1` 与请求序列，未做更长的多周期重叠压力验证。现有绿色测试和 covered 的 AC-062/063 追踪不构成 AC-062、AC-063 或 AC-077 的完整通过声明。
