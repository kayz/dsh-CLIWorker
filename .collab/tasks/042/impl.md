# Task 042 实现交接

提取了共用版本观察逻辑：使用规则表参数、隔离的参数数组和 20 秒超时执行，解析语义化版本，并保存 stdout 摘要和真实退出码。discover 复用该逻辑；models probe 对实际可识别目标做本次版本预检，失败时保存 unverified 和对应原因，不执行推理或记账。版本成功后仍由原有推理、nonce、身份和用量证据决定 callable。provider 版本检查也不会单凭版本授予 callable。模型调用期间传入现有安全执行层所需的 lookup，以支持 Windows 垫片；调用后恢复上下文。解释器和未知包装器不做版本预检，仍走原调用路径。

本轮补充扫描后目标消失的处理：绝对路径目标在执行前经 stat 明确报 ENOENT 时记录 command missing，避免 Windows 垫片回退把不存在的目标误报为非零退出；其他 stat 失败仍交由执行层判定。测试扩充为真实 bin 使用 11 个本地可执行夹具及三类失败、实际 argv 和落盘状态；还覆盖版本成功但真实调用认证失败、超时、非零退出、缺身份或 nonce 错误，同目标共享预检、不同目标隔离、前缀和解释器包装器，以及缓存刷新、消失和 gone。

自测：新增 integration 测试 9 项通过；acceptance 中独立生产行为块通过；原 discovery/probe 集成回归 39 项通过；check-no-model-table 和 check-generated-fresh 通过。运行时文件使用系统临时目录并清理。

单元回归上一轮未通过：`test/unit/import-safe.test.mjs` 中 `[AC-006] main returns {exitCode} and writes the result to ctx.stdout` 仍断言仅凭 provider 版本检查得到 callable，实际按本任务规格返回 unverified。该文件不在写域，未修改；上一轮结果为 533 通过、1 失败、1 跳过。本轮没有重复运行整个单元套件，其中部分测试会调用 git。`scripts/check-fast.ps1` 会运行包含 git 调用及生成报告的检查，与本任务禁止 git 和创建其他文件的要求冲突，因此未运行，不能声称完整门禁通过。
