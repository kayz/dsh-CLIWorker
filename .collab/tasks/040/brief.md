# Task 040 — 跨进程写入并发一致性

## 目标

多进程同时写 state 时不得丢更新。今晚修过 `lib/lock.mjs` 的回收竞态（曾导致 98/100 租约），但**没有一条专门的多进程写入测试**来守住这个语义。

可观察结果：N 个子进程各自完成一次提交，全部退出码 0 时，最终 state 里的条目数恰好等于 N；任何一次丢失都要被测试抓到。

## 约束

- 写域：`test/integration/cross-process-write.test.mjs`、`test/fixtures/store/**`、`test/traceability/T-040.json`
- **不要修改** `lib/` 下任何文件（本任务只加测试资产）；若确实发现实现缺陷，先在报告里写清楚，不要擅自改实现
- 不复用 `test/integration/store-concurrency.test.mjs` 的既有用例名，避免重复计数
- 子进程数不少于 20，且断言不得放宽为"大于等于某个比例"

## 建议验收方向

AC-083（integration）：N 进程并发写入后条目数精确等于成功提交数；重复运行多次保持稳定（至少 5 轮无失败）。

## 非目标

不测跨机器并发、不测网络文件系统

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
