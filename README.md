<p align="center">
  <img src="assets/ztools-logo.png" width="96" alt="ZTools Logo">
</p>

<h1 align="center">ZTools Extensions</h1>

<p align="center">ZTools 插件源码与开发工具</p>

<p align="center">
  <a href="https://www.ztools.cn">官网</a> ·
  <a href="https://www.ztools.cn/download.html">下载 ZTools</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools">客户端源码</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools-extensions/issues">插件问题</a>
</p>

本仓库提供 ZTools 声明式插件源码、SDK、脚手架及构建检查工具。插件通过 `List`、`Detail`、`Form`、`ActionPanel` 等组件描述界面，由 ZTools 客户端负责渲染。

## 浏览插件

插件源码位于 [`extensions/`](extensions/)。例如：

| 插件 | 源码 |
| --- | --- |
| 计算器 | [`calculator`](extensions/calculator/) |
| JSON 格式化 | [`json-format`](extensions/json-format/) |
| 文本对比 | [`file-compare`](extensions/file-compare/) |
| 时间戳转换 | [`timestamp`](extensions/timestamp/) |
| 单位换算器 | [`unit-converter`](extensions/unit-converter/) |
| UUID 生成器 | [`uuid-generator`](extensions/uuid-generator/) |

每个插件的 `plugin.json` 记录版本、入口、权限及 `targets` 平台声明。可安装内容以客户端插件市场为准。

系统操作、媒体处理等插件还可能依赖对应平台的宿主能力或外部组件；源码能够编译不代表这些运行条件已经满足。

## 开发插件

准备 Node.js 24（与本仓库 CI 一致）、Git，以及支持声明式插件的 ZTools 客户端。

### 1. 安装依赖

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci --ignore-scripts
```

### 2. 创建插件

```bash
npm run create-plugin -- my-tool "我的工具" "一个声明式插件" --target-dir extensions --platform cross
```

此命令生成 `extensions/my-tool/`。请保留 `--target-dir extensions`：脚手架默认目录为 `plugins/`，而本仓库的构建与检查工具读取 `extensions/`。`--platform` 可选 `cross`、`windows` 或 `macos`，用于生成对应的 `targets`。

### 3. 编译和检查

以下命令均在仓库根目录运行：

```bash
# 编译指定插件到 extensions/my-tool/dist/
node scripts/build-declarative.mjs my-tool

# 校验清单并扫描该插件的源码
node scripts/scan-plugin-security.mjs extensions/my-tool

# 运行脚手架生成的测试
node --test extensions/my-tool/tests/index.test.mjs
```

已有插件请把 `my-tool` 和测试文件路径替换为对应目录。测试通过后，还需在插件声明支持的平台上使用 ZTools 客户端验证实际功能；命令行构建本身不会打开预览窗口。

### 4. 提交贡献

阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，完成本地验证后提交 Pull Request。已有插件的版本规则、改动检查范围和平台要求见贡献指南。

## 目录结构

| 目录 | 内容 |
| --- | --- |
| [`extensions/`](extensions/) | 插件清单、源码、图标与测试 |
| [`extensions/shared/`](extensions/shared/) | 插件共用源码；插件中的副本需与此处一致 |
| [`packages/declarative-ui/`](packages/declarative-ui/) | 用于编译和测试的 SDK 类型与运行时代码 |
| [`packages/ztools-plugins-spec/`](packages/ztools-plugins-spec/) | 插件清单 Schema 与校验器 |
| [`scripts/`](scripts/) | 脚手架、构建与检查工具 |

## 问题反馈

插件或本仓库开发工具的问题请提交到[本仓库 Issues](https://github.com/ZToolsTeam/ZTools-extensions/issues)，注明插件 ID、版本、操作系统和复现步骤。客户端本身的问题请提交到 [ZTools Issues](https://github.com/ZToolsTeam/ZTools/issues)。

## 许可证

本仓库使用 [MIT License](LICENSE)。
