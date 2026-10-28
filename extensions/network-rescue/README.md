# 网络修复

检查网卡地址、DNS 解析、外网连通、代理与 hosts 文件，并提供刷新 DNS 缓存、关闭系统代理、重置 Winsock、恢复防火墙默认策略等修复操作。

## 使用

- 命令：网络修复。
- 打开时自动诊断：本机是否有可用的 IPv4 地址、能否解析 `www.baidu.com`、能否连接 `223.5.5.5` 的 TCP 53 端口、环境变量里是否设置了代理、hosts 文件的有效规则数（超过 50 条标为异常）。Winsock 与网络位置感知服务只按是否有可用 IP 推断，防火墙状态没有实际检测。
- 可执行的修复：刷新 DNS 缓存（`ipconfig /flushdns`）、关闭系统代理（把注册表 `ProxyEnable` 设为 0）、重置 Winsock（`netsh winsock reset`）、重新获取 DHCP 地址（`ipconfig /renew`）、恢复防火墙默认策略（`netsh advfirewall reset`）、重启网络位置感知服务；“检查 hosts”和“连通性检测”两项只读取或探测，不做修改。
- `Enter` 执行选中项的修复，`Ctrl+Enter` 复制列表里显示的命令（与实际执行的不完全一致，例如重置 Winsock 只执行 `netsh winsock reset`，重新获取 DHCP 只执行 `ipconfig /renew`），`Ctrl+R` 重新诊断，`Ctrl+K` 打开动作面板；有异常项时，可在顶部或动作面板里一次修复全部异常项。
- 修复前不再确认。恢复防火墙默认策略会清除你自己添加的防火墙规则。重置 Winsock、恢复防火墙、重启网络位置感知服务需要以管理员身份运行客户端，否则会提示失败。

## 平台与要求

- 支持：仅 Windows

## 网络与数据

- 诊断时解析 `www.baidu.com`，并连接 `223.5.5.5`（阿里公共 DNS）的 TCP 53 端口检测外网是否连通；不上传任何数据。
