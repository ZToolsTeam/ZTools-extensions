# 轻量接口调试

解析从浏览器开发者工具复制的 cURL 命令，发起 HTTP 请求查看响应，或把请求转成 Fetch、Axios、Python Requests、Go 代码。

## 使用

- 命令：在启动框输入“curl”或“接口调试”打开。
- 把 cURL 命令或 http / https 网址粘贴到搜索框，也可以在动作面板里从剪贴板载入。识别 `-X`、`-H`、`-d` / `--data*`、`-b`、`-u`、`--url` 参数，多行命令可用 bash 的 `\`、cmd 的 `^` 或 PowerShell 的反引号续行；浏览器开发者工具里“Copy as cURL (bash)”和“Copy as cURL (cmd)”复制的命令都能识别（含 cmd 的 `^"` 转义）。
- 顶部下拉框选择生成代码的语言：JavaScript Fetch、TypeScript Axios、Python Requests、Go net/http。
- Enter：发起请求，右侧显示状态码、耗时和响应正文（JSON 自动格式化）；⌘/Ctrl+Enter：复制生成的代码；⌘/Ctrl+K：打开动作面板，可复制响应正文。
- 只能发起 GET、HEAD、POST、PUT、DELETE 请求，DELETE、PUT 发送前需要确认，DELETE 不能带请求体，其他情况请复制生成的代码自行执行。请求超时为 10 秒；只显示响应正文，不显示响应头；正文超过 5 MB 时截断显示。

## 平台与要求

- 支持：Windows、macOS

## 网络与数据

- 只向你输入的地址发请求，请求由客户端发出。插件不保存请求和响应。
