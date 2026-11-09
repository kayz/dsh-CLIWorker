# Task 041 — 生成资产 freshness gate：生成后必须无 diff

## 目标

仓库里有多类"由生成器产出"的资产：`test/fixtures/release-gate/**`（42 个夹具 root，内嵌 AC 索引快照）与 `docs/contract.md`。它们会随契约变化而过期，但**没有任何检查提醒**。

今晚已经因此踩坑两次：AC 索引从 75 扩到 79 后夹具全部过期，本地因为"重新生成过但没提交"而绿，任何干净 worktree 直接全红。

本任务交付一条 CI 检查：**对每个生成器跑一次生成，断言工作区无 diff**。过期即失败，并指出哪个生成器。

## 约束

- 写域：`scripts/check-generated-fresh.mjs`、`test/unit/check-generated-fresh.test.mjs`、`test/fixtures/release-gate/generate.mjs`、`docs/release-checklist.md`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`contracts/spec/**`
- 检查必须**在 CI 的安全范围**内：只生成到临时目录或生成后精确回滚，不得让检查本身污染工作区（若生成器只支持就地生成，则必须先在临时副本里跑）
- 不放宽既有断言；不得把失败降级为警告

## 建议验收方向

AC-084（unit + contract）：干净树通过；人为改坏一份夹具后失败且指名生成器；索引变化导致夹具过期时失败。用临时目录构造上述三种场景，不依赖真实生成器的副作用。

## 非目标

不重写各生成器本身

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
