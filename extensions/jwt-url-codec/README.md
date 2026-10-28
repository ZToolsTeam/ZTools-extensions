# JWT与URL解析

离线查看 JWT 的 Header、Payload 和时间声明，校验或签发 HS256 签名，也可拆解 URL 与 Query 参数。

## 使用

- 命令：`jwt`、`token`、`url`、`urldecode`、`JWT解析`、`URL解析` 等。
- 用搜索框右侧的下拉框切换 JWT 或 URL 模式，把内容粘贴到搜索框即可解析；JWT 可带 `Bearer ` 前缀。JWT 模式动作面板里的「从剪贴板重新读取 Token」会读取剪贴板，并按内容自动切换模式。
- JWT：选中概览行，Enter 复制 Payload JSON，⌘/Ctrl+Enter 复制 Header JSON。时间状态每秒更新；“尚未过期”只描述时间声明，不代表签名或授权有效。
- 校验签名：先复制密钥，在概览行按 ⌘/Ctrl+K 选择「使用剪贴板密钥校验 HS256 签名」。密钥中的空格会原样参与计算；修改 Token 后需要重新验签。
- 签发 JWT：JWT 模式下点顶部「签发 JWT」，填写 Payload、Header 和密钥，按 ⌘/Ctrl+Enter 签发并复制。仅支持 HS256，不支持 `crit` / `b64` 扩展；不会自动添加有效期，也不保存密钥。复制失败会保留表单供重试。
- URL：支持完整 URL、域名路径和 `?a=1`、`a=1&b=2` 形式的查询。Enter 复制完整 URL（保留编码），⌘/Ctrl+Enter 复制 Query 参数 JSON，重复键用数组保留全部值。Query 只解码一次，解码预览仅供阅读。
- 签名一致只能证明内容与所给密钥匹配，不验证业务系统的签发方、接收方或授权策略。输入内容在详情中按原文显示，不会作为 Markdown 图片或链接加载。

## 平台与要求

- 支持：Windows、macOS

## 网络与数据

- 不联网，数据只保存在本机。
