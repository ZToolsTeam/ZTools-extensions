# Git救命锦囊

按日常说法检索 Git 撤销与找回命令，生成 Conventional Commits 格式的提交信息，并按技术栈合成 .gitignore 内容。插件只生成文本供复制，不执行任何 Git 命令。

## 使用

- 命令：三个命令分别打开三种模式，也可以在搜索框右侧切换：
  - 大白话检索 Git 翻车现场自救回滚命令（撤销提交/找回代码/合并冲突等），关键词如 `git救命`、`撤销commit`；
  - 交互式生成符合团队规范的 Conventional Commits 结构化提交信息，关键词如 `commit规范`、`cz`；
  - 按技术栈与操作系统组合生成标准 .gitignore 忽略文件内容，关键词如 `gitignore`。
- 自救场景：撤销最近一次提交并保留修改、补交漏提的文件或改提交备注、找回误删分支或 `reset --hard` 前的代码、误提交到主分支、撤销混乱的 pull / merge、回滚已推送到公共分支的提交。`Enter` 复制首选命令，`⌘/Ctrl+Enter` 复制完整指南（每行都以 `#` 开头，粘贴到终端不会执行）；指南里的可选方案要按实际情形选择，不要整段连续执行。
- 撤销最近一次未推送的提交时，首选命令先建立 `backup/before-undo` 恢复分支再软重置；该分支已存在时命令会停止，可换一个新名字。恢复分支只保存已提交的内容，未提交的文件需要另行备份。
- 提交生成器：先在搜索框输入改动说明，支持 `scope:说明` 写法（英文冒号）；选中提交类型后 `Enter` 复制完整的 `git commit -m` 命令，`⌘/Ctrl+Enter` 只复制提交信息文本。没有输入说明时不能复制。复制的命令适用于 Bash、zsh 和 Windows 上的 Git Bash；PowerShell、CMD 用户请复制提交信息后在对应终端或 Git 界面提交。
- .gitignore：选中技术栈按 `⌘/Ctrl+Enter` 勾选或取消（Node、React / Vue、Python、Java、Go、Rust、macOS、Windows、IDE），默认已勾选 Node、React / Vue、macOS、Windows 与 IDE；右侧预览去重后的合成结果，`Enter` 复制全文。
- 已经推送共享的提交请用反向提交处理；合并冲突时中止合并与合并完成后撤销是不同情形，具体行为以 Git 官方文档为准。

## 平台与要求

- 支持：Windows、macOS

## 网络与数据

- 不联网，所有内容在本机生成。
