# 实现记录

本任务尚未完成，不能视为通过 AC-059、AC-060 或 AC-061。

已添加 `lib/http/routes.mjs`，列出设计中的方法、路径与级别；jobs 仍是待展开的模板。添加 `lib/http/security.mjs`，提供 loopback 三项校验以及实例内随机会话、到期检查和 HMAC CSRF 校验。添加 `test/integration/plugin-session.test.mjs`，对这些独立基础函数做了初步检查。上述模块尚未接入 `lib/index.js`，因此目前不提供实际 HTTP 防护。

自测：`node --test test/integration/plugin-session.test.mjs` 通过 2 项；`node --test "test/unit/*.test.mjs"` 退出 0（473 项，472 通过，1 项既有跳过）；`node scripts/check-acceptance.mjs .collab/tasks/024/acceptance.md` 通过，warnings=0。这些结果不代表任务验收通过。

尚需实现插件注册、各路由守卫和业务分发、健康收集及 doctor、flows、完整集成测试与 traceability，之后执行验收命令。未执行 `scripts/check-fast.ps1`：设计说明其隐含调用 git 或写报告，而本轮禁止执行 git 和创建范围外文件。

续接第 1 轮新增 `lib/http/guard.mjs`：使用既有注册表的判定函数处理管理路由门控，提供标准错误响应和按字节限制的 JSON 读取；请求超限时立即拒绝，继续排空而不销毁响应。新增 `test/integration/plugin-guard.test.mjs`，对声明的管理写路径检查门控优先级和不读取 body，并检查畸形及超限输入。运行 `node --test test/integration/plugin-guard.test.mjs test/integration/plugin-session.test.mjs`，4 项通过。

本轮新增模块同样尚未接入生产插件；这些测试只覆盖独立模块，并未执行 flows 或覆盖实际 HTTP 请求，不能当作 AC-060 通过。上述尚需工作仍未完成。

本次续接新增 `lib/health.mjs`、`lib/commands/doctor.mjs` 和两份 `[AC-061]` 测试；现有插件注册公共 health 路由，doctor 使用 streamed 钩子，正常与配置缺失时由同一收集器生成报告。测试覆盖基本聚合、配置缺失和进程内 CLI 分发与 HTTP 报告一致性。`node scripts/run-tests.mjs --ac AC-061` 退出 0（3 项）；`node --test "test/unit/*.test.mjs"` 退出 0（475 项，1 项跳过）；`node scripts/check-traceability.mjs` 退出 0。

这并不代表完整 AC-061 已覆盖：真实独立 CLI 进程、故障矩阵、flows、精确时间边界及注册失败对照等仍待实现或验证。现有 registration 测试仍按旧四路由断言，新增 health 后运行该测试有 2 项失败；session/ui、其他新路由和管理读鉴权尚未接入，不能仅改测试冒充完成。注册更新、完整 T-024 追溯及所有原验收要求仍未完成。

本次续接将声明表接入插件注册，加入实例会话、自举、管理读写守卫和 select 视图检查，注册失败改为脱敏；更新注册测试，并新增实际宿主请求的路由和守卫测试。health 的探测过期边界调整为与现有选择规则一致。已运行六个相关测试文件，共 14 项通过；unit 回归 475 项、0 失败、1 项既有跳过；`node scripts/check-traceability.mjs` 通过。

仍未完成：管理写路由通过守卫后的业务分发目前返回 `E_INTERNAL`，snapshot/jobs 除测试注入外无数据处理；尚未验证真实目录首写、完整 select/leak-scan、flows、健康故障矩阵及 T-024 追溯分片。上述测试不足以证明三项 AC 达标，不能发布为完成的实现。此段取代前文中“session/ui、其他新路由和管理读鉴权尚未接入”的状态描述。

续接第 2 轮：将 `manual-model`、`pool`、`allow`、`deny`、`level` 和 `alias` 连接到已有领域函数；用 model/v1 或 pool 既有字段作为输入，并验证自举响应中的 session/csrf 可用于首个目录写入。新增 HTTP select/admin flow，记录响应并进行秘密扫描；select flow 使用实际目录和 wrapper 执行 scanView。doctor flow 改为真实 CLI 和八项检查。新增健康测试覆盖清单年龄、损坏缓存、文件时钟和实例注册失败；新增 T-024 追溯分片，三项暂列 planned。

自测：AC-059 对应测试 8 项、AC-060 测试 6 项、AC-061 测试 7 项均通过；完整 flow 测试通过；unit 回归 476 项中 475 通过、1 跳过；traceability 与 acceptance 格式检查通过。上述数量不是验收覆盖证明，尚未完成其他写路由业务、全部健康故障矩阵、session 与各视图的完整验证；check-fast 未执行。

本轮执行 unit 回归时没有预先发现 `test/unit/gitignore.test.mjs` 会间接调用 `git check-ignore`，因此该命令实际触发了用户禁止的 Git 调用。后续不得再运行会间接调用 Git 的门禁；`scripts/check-fast.ps1` 包含完整测试运行，因而不能执行。
