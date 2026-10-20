<p align="center">
  <img src="assets/ztools-logo.png" width="96" alt="ZTools Logo">
</p>

<h1 align="center">ZTools Extensions</h1>

<p align="center">ZTools 官方插件与开发工具</p>

<p align="center">
  <a href="https://www.ztools.cn">官网</a> ·
  <a href="https://www.ztools.cn/download.html">下载 ZTools</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools">主程序</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools/issues">问题反馈</a>
</p>

为 Windows 与 macOS 上的 ZTools 开发插件。通过声明式 UI 编写界面，使用统一的主题、组件与键盘交互；每个插件支持的平台以其清单为准。

## 5 分钟贡献你的首款插件

### 1. 克隆本仓库并安装依赖

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci
```

### 2. 一行命令生成插件工程

```bash
# 格式: npm run create-plugin <plugin-id> [title] [description]
npm run create-plugin my-tool "我的效率工具" "基于声明式 UI 的日常好帮手"
```

脚手架将在 `extensions/my-tool/` 生成符合规范的标准工程。

### 3. 编译与本地预览

```bash
node scripts/build-declarative.mjs my-tool   # 从 src/ 编译到 dist/
```

打开 ZTools 客户端「设置」→「开发者」→「加载本地开发插件」，选择 `extensions/my-tool` 目录即可预览。

### 4. 提交 PR

```bash
npm test   # 本地运行与 CI 相同的合并前检查（只检查你改动的插件）
```

提交 PR 后，CI 会对改动涉及的插件做以下检查。检查通过后由维护者审核、合并并安排发布：

1. 目录名必须与 `plugin.json` 的 `id` 一致，且全仓库不能重复；
2. 从 `src/` 源码编译（不接受提交的编译产物，`dist/` 不进仓库）；
3. 清单规范与 AST 安全扫描：严禁 `eval`、`new Function`、代码混淆、未声明的 Node 原生模块；
4. 插件自带测试（`tests/*.test.mjs`）必须通过；
5. **修改已有插件必须升高 `version`**（安装包按版本号长期缓存，同版本换内容会导致用户安装失败）；
6. 不能直接删除插件目录；需要下架时在 `plugin.json` 写 `"revoked": true` 和 `"revokedReason": "原因"`，客户端会自动禁用已安装的该插件；
7. `plugin.json` 必须用 `targets` 声明支持的平台（见下一节），审核时会按声明在对应系统上验证。

## 支持平台：跨平台 / 仅 macOS / 仅 Windows

插件在 `plugin.json` 的 `targets` 里声明支持哪些系统，客户端只在声明的系统上显示该插件，插件市场也按此标注：

```jsonc
// 跨平台：两个目标都写
"targets": [
  { "id": "windows-electron-any", "platform": "windows", "runtime": "electron", "arch": "any" },
  { "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }
]
// 仅 macOS：只写 macos 目标；仅 Windows：只写 windows 目标
"targets": [{ "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }]
```

只用到声明式 UI 与跨平台宿主接口的插件写跨平台；用到某个系统独有能力（Windows 注册表、macOS AppleScript 等）的只写那个系统。
功能还没做完时在 `plugin.json` 写 `"draft": true` 和 `"draftReason": "还差什么"`，合并后不会发布。

## 插件列表

### 跨平台（Windows 与 macOS）（27）

| 名称 | 目录 | 版本 |
| --- | --- | --- |
| Base64 图片转换 | `base64image` | 1.0.0 |
| 批量重命名 | `batch-rename` | 2.0.1 |
| 编码转换 | `batch-text-convert` | 1.0.0 |
| 计算器 | `calculator` | 2.0.0 |
| 日程与会议 | `calendar` | 2.0.1 |
| 中文数字与金额转换 | `chinese-number-converter` | 1.0.0 |
| 剪贴板历史 | `clipboard-manager` | 2.0.1 |
| 颜色转换 | `color-picker` | 2.0.0 |
| 加解密与散列 | `crypto-tool` | 1.0.1 |
| 磁盘空间透视分析器 | `disk-analyzer` | 2.0.1 |
| Everything 文件秒搜 | `everything-file-search` | 2.0.1 |
| 文本对比 | `file-compare` | 2.0.0 |
| 2FA 验证码 | `google-auth` | 1.0.1 |
| 电脑硬件信息与温度监控 | `hardware-info` | 2.0.1 |
| JSON 格式化 | `json-format` | 2.0.0 |
| 便签 | `memo` | 1.0.1 |
| 端口管理器 | `port-manager` | 1.0.1 |
| 系统进程与服务深度监控 | `process-monitor` | 2.0.1 |
| 二维码生成 | `qr-code` | 2.0.0 |
| 常用文件夹 | `quick-folders` | 1.0.1 |
| 多屏区域截图与悬浮贴图 | `screenshot` | 2.0.1 |
| 文本排版与格式化助手 | `text-formatter` | 1.0.0 |
| 时间戳转换 | `timestamp` | 1.0.0 |
| 待办清单 | `todo` | 1.0.0 |
| 单位换算器 | `unit-converter` | 1.0.0 |
| UUID生成器 | `uuid-generator` | 1.2.0 |
| 全球世界时钟 | `world-clock` | 1.0.0 |

### 仅 Windows（30）

核心功能依赖 Windows 系统能力（注册表、Windows 原生组件等），macOS 客户端不显示。

| 名称 | 目录 | 版本 |
| --- | --- | --- |
| AI 图像超分与修复 | `ai-image` | 2.0.1 |
| AI 视频超分增强 | `ai-video` | 2.0.1 |
| 批量音频处理 | `batch-audio` | 2.0.1 |
| 批量视频处理 | `batch-video` | 2.0.1 |
| 开机加速与启动项管理 | `boost` | 2.0.1 |
| 系统垃圾深度清理 | `cleaner` | 2.0.1 |
| 系统右键菜单管理 | `context-menu` | 2.0.1 |
| 误删数据恢复向导 | `data-recovery` | 2.0.1 |
| 网络流量实时监控与防火墙 | `flow-guard` | 2.0.1 |
| 进程管理急救箱 | `kill-process` | 2.0.1 |
| 局域网极速文件共享 | `lan-share` | 2.0.1 |
| C盘大文件无损搬家 | `mover` | 2.0.1 |
| 多线程极速下载器 | `multi-download` | 2.0.1 |
| 网络适配器 | `network-adapter` | 2.0.1 |
| 网络急救箱 | `network-rescue` | 2.0.1 |
| 离线图片文字识别 (OCR) | `ocr` | 2.0.1 |
| PDF 全能转换与合并工具箱 | `pdf` | 2.0.1 |
| QQ 专项深度清理 | `qq-cleaner` | 2.0.1 |
| 高清屏幕录制与动图工作台 | `record` | 2.0.1 |
| 屏幕像素级取色放大镜 | `screen-color-picker` | 2.0.1 |
| 文件解锁与强力粉碎机 | `shredder` | 2.0.1 |
| 定时关机 | `shutdown-timer` | 1.0.1 |
| 软件卸载与残余深度清理 | `software-manager` | 2.0.1 |
| SQLite 本地数据库安全探查器 | `sqlite-plugin` | 2.0.1 |
| 系统配置与关键目录快照备份 | `system-backup` | 2.0.1 |
| Windows 极客系统工具集 | `system-tools` | 2.0.1 |
| 流媒体音视频嗅探下载器 | `video-downloader` | 2.0.1 |
| 微信专项深度清理 | `wechat-cleaner` | 2.0.1 |
| 微信多开与账号管理助手 | `wechat-multi` | 2.0.1 |
| 窗口句柄与置顶分屏管理器 | `window-manager` | 2.0.1 |


## 目录结构

```
extensions/<plugin-id>/          插件（plugin.json、src/、tests/、icon）
extensions/official/<plugin-id>/ 官方分组插件
extensions/shared/               公共源码（hash.ts、native-ipc.ts），以复制方式进入插件 src/，副本必须与此一致
packages/declarative-ui/         SDK 类型声明（运行时由客户端提供）
packages/ztools-plugins-spec/    插件清单规范与校验器
scripts/                         脚手架、构建、安全扫描、合并前检查、发布脚本
```

## 核心规范（纯声明式 UI）

- 严禁直接操作 HTML DOM，严禁手写自定义 CSS；
- 统一使用 `<List>`, `<Detail>`, `<Form>`, `<ActionPanel>`, `<Action>`，由宿主统一样式与主题；
- 键盘优先：方向键聚焦，`Enter` 执行主动作，`Ctrl+K` 打开动作面板。

## 开源协议

本项目遵循 [MIT License](LICENSE)。
