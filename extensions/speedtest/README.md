# 网络测速

Mac 版提供两种独立操作：

- **宽带测速**：选中“开始宽带测速”按 Enter，使用 macOS 自带 `networkQuality` 进行约 15 秒的上下行测量。会消耗实际流量，高速网络下可能达到 GB 级。结果是到 Apple 测试服务的吞吐量，受 VPN、当前网络负载和服务节点影响。
- **节点检测**：顶部“检测预设节点”或“网络诊断”快捷命令，读取真实默认路由并检测网关，再用 TCP 443 检测预设网站：腾讯（www.qq.com）、淘宝（www.taobao.com）、哔哩哔哩（www.bilibili.com）、GitHub（github.com）、Cloudflare（www.cloudflare.com）。也可搜索输入域名、IPv4、IPv6 或主机:端口（不写端口时使用 443），选中检测行按 Enter。

网站节点用同一远端地址的三次 TCP 建连测量平均延迟与相邻样本差，不能据此断定网站登录等业务可用。默认网关使用 ICMP；未提供网关（如部分 VPN 隧道）时会说明原因，不猜测地址。

“停止检测”和离开插件都会请求终止当前操作。超时、权限不足、测速服务不可达时展示错误，不生成估算网速。报告可复制，未测量的指标显示“未提供”。

参考：[Apple 网络响应测试](https://support.apple.com/en-us/101942)，本机 `man networkQuality`。

## 平台与要求

- 支持：仅 macOS
- 需要客户端 1.1.8.5 或更新。
- 需要带有 `networkQuality` 的 macOS。
- Windows 版暂不提供：插件市场不向 Windows 上架，即使在 Windows 上打开也只会提示暂不可用，不显示估算的带宽或网关。

## 网络与数据

- 宽带测速调用 macOS 自带的 `networkQuality`，连接 Apple 的测试服务，具体服务器由系统决定。
- 节点检测用 TCP 443 连接上面列出的 5 个网站，并用 ICMP 检测默认网关；手动输入地址时只连接你输入的地址。
