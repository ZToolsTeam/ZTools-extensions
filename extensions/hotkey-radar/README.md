# 热键侦测

支持全局快捷键检测与离线速查。

Mac：在检测页输入 `⇧⌘P` 或 `Shift+Cmd+P` 后按 Enter 检测，⌘Enter 复制选中组合。搜索框右侧切换速查应用；速查页的 Enter 复制 Mac 默认键位。检测结果与速查统一用 ⌃⌥⇧⌘ 符号显示；⌘ 与 ⌃ 分开处理，⌥ 即 Option（Alt），加号键写 `Plus`。

Mac 结果含义：

- **系统已分配**：系统当前启用的键盘快捷键配置中有这组键。
- **存在独占占用**：macOS 拒绝另一份独占注册，但不提供占用进程名称。
- **ZTools 已注册**：当前客户端持有该绑定，检测不会撤销它。
- **可独占注册**：本次临时注册成功且已释放。**不等于没有冲突**：其他应用的共享注册、事件拦截、键盘重映射和应用内快捷键不能被完整枚举。

Mac 版检测读取当前键盘布局，不修改系统键位或结束进程。结果只代表检测时刻。请求失败、组件缺失或布局无法映射时会显示错误，不补充“空闲”结果。检测页的动作面板提供排查方法。

Windows：只有系统 RegisterHotKey 拒绝时才算占用（Win+L、Alt+Tab 等系统保留组合直接标为系统保留），正在运行的软件只作为可能来源提示；检测失败显示“热键检测未完成”。含暂不支持检测按键的组合显示“无法检测”。检测结果行按 Enter 复制组合键；也可在搜索框输入带 `+` 的组合单独检测；Windows 速查页按 Enter 复制 Windows 键位。

速查收录默认配置，自定义绑定以应用自身设置为准。参考：[Apple Mac 快捷键](https://support.apple.com/zh-cn/102650)、[VS Code Mac 默认键位](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf)、[Excel 快捷键](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel)、[Photoshop 图层盖印](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/merge-and-stamp-layers.html)、[Chrome 快捷键](https://support.google.com/chrome/answer/157179)、[Edge 快捷键](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge)。

## 平台与要求

- 支持：Windows、macOS
- 需要客户端 1.1.8.5 或更新。
- macOS 需要客户端带有 Mac 热键组件；从源码运行时需要先构建该组件。
- Windows 实现尚待真机复核。

## 网络与数据

- 不联网，数据只保存在本机。
