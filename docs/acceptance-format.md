# 验收文档格式

任务验收文档 `acceptance.md` 由验收 runner 逐条解析执行。散文式写法会让 runner 解析出 0 条命令、不生成 `ci-results.json`，任务最终被判为 `ci_failed`。`scripts/check-acceptance.mjs` 把这种失败提前到生成阶段。

## 必须满足

1. **每个验收项一个二级标题**，形如：

   ```markdown
   ## AC-036 标题文字
   ```

   `AC-036（integration）` 这类普通段落、列表项或加粗文字都不算小节。
2. **每个 AC 小节至少一条可执行命令**：单行 `- 命令: <命令>`，或一个 `pwsh` 代码块。门禁只把 `pwsh` 代码块当命令，`powershell`、无语言或其他语言的代码块都不算。
3. **每条命令打印哨兵**：成功时 stdout 必须包含 `<AC-id> OK`，例如 `AC-036 OK`。
4. **AC id 不重复**：同一个 id 只能出现在一个小节标题里；需要拆多条检查时，把命令都放进同一个小节。

## 本地自检

```powershell
node scripts/check-acceptance.mjs <acceptance.md>   # 检查指定文件
node scripts/check-acceptance.mjs                   # 扫描尚未归档的任务
```

退出码：`0` 全部通过，`1` 有格式失败，`2` 参数或路径错误。缺少 `AC-id OK` 只告警，不算失败。不带参数时，已有 `ci-results.json` 或状态为 `merged` 的任务会被视为已归档并跳过；没有任何待检查任务时同样以 `0` 退出。

参考最近合并任务的 `acceptance.md`（例如 Task 036）的写法。
