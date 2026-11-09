# 实现说明

新增生成资产检查，在系统临时目录分别复制必要输入并运行两个生成器，比较完整夹具文件集合及契约文档，报告差异并清理临时目录。比较仅规范化换行和指定的运行环境元数据，以便检测源输入变化而不受运行环境噪声影响。新增隔离替身测试，并在发布清单中记录检查及维护流程。

自测：运行 `node --test test/unit/check-generated-fresh.test.mjs`、`node scripts/check-generated-fresh.mjs`、`node --test "test/unit/*.test.mjs"` 和验收格式检查。完整 check-fast 会调用 Git，与本次禁止执行 Git 的指令冲突，因此未运行。
