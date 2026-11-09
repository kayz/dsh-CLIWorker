# 实施说明

- 在 `package.json` 的发布清单追加 UI 目录和指定 HTML，使安装包包含界面资产。
- 新增 `scripts/check-package-contents.mjs`，以离线、禁用生命周期脚本的 npm dry-run 清单检查三个目录的全部普通文件及指定 HTML；临时 npm 缓存使用后清理。新增 unit 和实际打包契约测试，覆盖缺失资产、额外嵌套文件及 npm 和清单错误。发布清单补充该检查与修复方式。
- 自测：`node scripts/check-package-contents.mjs` 输出 `AC-087 OK`；`node --test test/unit/package-contents.test.mjs` 三项通过；验收文档中的独立清单与临时副本反例的 Node 内容通过并输出 `AC-087 OK`；`node scripts/check-acceptance.mjs .collab/tasks/044/acceptance.md` 通过，warnings=0。独立反例使用系统临时 npm 缓存，因为默认缓存不可写。
- 未运行完整 `scripts/check-fast.ps1`：现有测试会执行 Git 命令，与本任务禁止执行 Git 的要求冲突；当前环境也未找到 PowerShell 7，无法直接运行验收中的 PowerShell 命令块。以上结果不代表完整门禁通过。
