<p align="center">
  <img src="assets/ztools-logo.png" width="96" alt="ZTools Logo">
</p>

<h1 align="center">ZTools Extensions</h1>

<p align="center">ZTools 插件源码与开发工具</p>

<p align="center">
  <a href="https://www.ztools.cn">官网</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools/releases">下载 ZTools</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools">客户端源码</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools-extensions/issues">插件问题</a>
</p>

本仓库存放 ZTools 插件的源码，以及开发插件要用的 SDK、脚手架、构建和检查脚本。插件用 `List`、`Detail`、`Form`、`ActionPanel` 等声明式组件描述界面，由 ZTools 客户端负责渲染和提供系统能力。

**只想安装插件**：从 [ZTools Releases](https://github.com/ZToolsTeam/ZTools/releases) 下载客户端，在客户端的插件市场里安装。仓库里有某个插件的源码，不代表它已经在市场上架，能装哪些以插件市场为准。

## 5 分钟贡献你的首款插件

准备 Node.js 24 和 Git，然后在终端执行：

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci --ignore-scripts

# 生成 extensions/my-tool/（一个能直接运行的示例插件）
npm run create-plugin -- my-tool "我的工具" "一句话说明插件做什么" --author "你的名字"

# 编译、检查、测试
node scripts/build-declarative.mjs my-tool
node scripts/scan-plugin-security.mjs extensions/my-tool
node --test extensions/my-tool/tests/*.test.mjs
```

接下来改 `extensions/my-tool/src/` 实现功能，在 ZTools 客户端里试用，最后提交 Pull Request。每一步怎么做见 [开发入门](docs/getting-started.md)。

## 文档

| 文档 | 什么时候看 |
| --- | --- |
| [开发入门](docs/getting-started.md) | 第一次写插件：创建、编译、测试、在客户端里试用、提交 |
| [界面规范](docs/ui-guidelines.md) | 设计界面前：三种标准布局、键盘约定、提交前自检 |
| [API 参考](docs/api.md) | 写代码时：组件与属性、系统能力、可用模块、权限 |
| [审核标准](docs/review.md) | 提交前：官方审核看什么、CI 检查什么 |
| [发布规则](docs/publishing.md) | 改清单或发新版本时：版本号、平台、草稿、下架 |
| [贡献指南](CONTRIBUTING.md) | 提交 Pull Request 前的检查清单 |

## 目录结构

| 目录 | 内容 |
| --- | --- |
| [`extensions/`](extensions/) | 每个插件一个目录：清单、源码、图标与测试 |
| [`extensions/shared/`](extensions/shared/) | 插件共用的源码和测试工具；插件里的副本必须与这里一致 |
| [`packages/declarative-ui/`](packages/declarative-ui/) | 编译和测试用的 SDK（类型声明与运行时）；用户安装后由客户端提供运行时 |
| [`packages/ztools-plugins-spec/`](packages/ztools-plugins-spec/) | 插件清单的 Schema 与校验器 |
| [`scripts/`](scripts/) | 脚手架、构建、扫描、合并前检查与发布脚本 |

## 问题反馈

插件或本仓库开发工具的问题请提交到[本仓库 Issues](https://github.com/ZToolsTeam/ZTools-extensions/issues)，注明插件 ID 与版本、客户端版本、操作系统及架构、复现步骤和错误信息；源码构建问题请附 Node.js 版本与执行的命令。日志和截图请先去掉个人信息与凭据。客户端本身的问题请提交到 [ZTools Issues](https://github.com/ZToolsTeam/ZTools/issues)。

## 许可证

本仓库使用 [MIT License](LICENSE)。
