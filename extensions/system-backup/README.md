# 系统备份

把 Hosts、SSH 配置、Git 与 npm 全局配置、PowerShell 7 启动脚本、Windows Terminal 设置和 VS Code 设置打包成 ZIP 归档，换机或重装系统后从归档中取回。

## 使用

- 命令：系统备份（插件主命令）。
- 打开后检查以下文件，只列出本机存在的：`C:\Windows\System32\drivers\etc\hosts`、`%USERPROFILE%\.ssh\config`、`%USERPROFILE%\.gitconfig`、`%USERPROFILE%\.npmrc`、`文档\PowerShell\Microsoft.PowerShell_profile.ps1`、Windows Terminal（应用商店版）的 `settings.json`、VS Code 的用户 `settings.json`。不包含 PATH 等环境变量，也不包含 SSH 私钥。
- 扫描后这些文件默认全部勾选，可以取消不需要的项。选中其中一项按 `Enter` 打包已勾选的文件；归档保存在 `文档\ZToolsBackups`，文件名形如 `ztools-backup-<时间>.zip`。`Ctrl+Enter` 在资源管理器中定位所选文件，`Ctrl+K` 打开动作面板。
- 搜索框右侧的备份策略选项目前不影响打包内容，三种策略打包的都是勾选的文件。
- 归档里只按文件名存放，不保留原目录结构；同名文件（例如 Windows Terminal 与 VS Code 的 `settings.json`）解压时后一个会覆盖前一个，建议分两次备份。
- 列表也会显示 `文档\ZToolsBackups` 中已有的归档。选中归档按 `Enter` 还原：内容解压到归档旁的 `<归档名>_restored` 文件夹，不覆盖原配置文件，需要自行复制回原位置。
- 读取不到的文件会跳过；一个文件都没打包成功时提示失败原因，不生成空归档。

## 平台与要求

- 支持：仅 Windows

## 网络与数据

- 不联网，数据只保存在本机。
