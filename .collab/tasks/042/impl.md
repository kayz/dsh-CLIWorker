# Task 042 实现交接

提取了共用版本观察逻辑：使用规则表参数、隔离的参数数组和 20 秒超时执行，解析语义化版本，并保存 stdout 摘要和真实退出码。discover 复用该逻辑；models probe 对实际可识别目标做本次版本预检，失败时保存 unverified 和对应原因，不执行推理或记账。版本成功后仍由原有推理、nonce、身份和用量证据决定 callable。provider 版本检查也不会单凭版本授予 callable。模型调用期间传入现有安全执行层所需的 lookup，以支持 Windows 垫片；调用后恢复上下文。解释器和未知包装器不做版本预检，仍走原调用路径。

自测：新增 integration 测试 4 项通过，包含真实 bin 先 discover 再 models probe、11 项规则观察、版本解析及失败降级；acceptance 中独立生产行为块通过；原 discovery/probe 集成回归 39 项通过；check-no-model-table 和 check-generated-fresh 通过。

单元回归未通过：`test/unit/import-safe.test.mjs` 中 `[AC-006] main returns {exitCode} and writes the result to ctx.stdout` 仍断言仅凭 provider 版本检查得到 callable，实际按本任务规格返回 unverified。该文件不在写域，未修改；本次单元运行结果 533 通过、1 失败、1 跳过。`scripts/check-fast.ps1` 会运行包含 git 调用及生成报告的检查，与本任务禁止 git 和创建其他文件的要求冲突，因此未运行，不能声称完整门禁通过。

新增测试尚未覆盖 design 要求的全部矩阵，例如每种版本失败都经真实 bin、认证失败/超时/非零推理的独立新负例、不同目标及同目标多模型隔离、扫描后目标消失和完整缓存转换。既有回归覆盖部分相关路径，但不能替代这些指定测试；AC-085 尚不能完整宣称通过。
