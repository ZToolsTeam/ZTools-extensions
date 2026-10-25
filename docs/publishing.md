# 发布规则

本文说明插件目录怎么组织、清单字段怎么写、改动时版本号怎么升、平台怎么声明，以及草稿和下架怎么处理。字段的完整定义以 [`plugin.schema.json`](../packages/ztools-plugins-spec/plugin.schema.json) 为准。

PR 合并后由官方发布到插件市场。

## 插件目录

每个插件一个目录，目录名就是插件 ID：

```text
extensions/<id>/
├── plugin.json        清单
├── package.json       只写 { "type": "module" } 等基本信息，不装依赖
├── tsconfig.json      编译配置
├── icon.svg           图标（也可以是 png / jpg / webp / ico）
├── src/               源码
├── tests/             测试（*.test.mjs）
└── README.md          插件说明
```

`dist/` 是编译产物，不提交，CI 会从源码重新编译。用 `npm run create-plugin` 生成的目录已经是这个结构，见 [开发入门](getting-started.md)。

## 清单字段

### 必填字段

| 字段 | 说明 |
| --- | --- |
| `id` | 插件 ID：小写字母开头，只用小写字母、数字和短横线，长度 2–64，必须与目录名一致且全仓库唯一。发布后不要再改 |
| `name` | 显示名称，不超过 50 个字符 |
| `version` | 版本号，`主.次.修订` 三段数字（如 `1.2.0`），可带 `-beta.1` 这类后缀。改动规则见 [版本号](#版本号) |
| `description` | 一句话说明插件做什么，不超过 500 个字符 |
| `author` | 作者，字符串，或 `{ "name": "…", "email": "…", "url": "…" }` |
| `entry` | 编译后的入口，通常是 `dist/index.js`。必须是插件目录内的相对路径 |
| `icon` | 图标文件的相对路径，如 `icon.svg` |
| `permissions` | 用到的权限，见 [API 参考 · 权限](api.md#权限)；不用任何权限写 `[]` |
| `targets` | 支持的平台，见 [平台声明](#平台声明) |
| `nativeComponents` | 写 `[]` |

### 常用的可选字段

| 字段 | 说明 |
| --- | --- |
| `mode` | `view`（默认，有界面）或 `no-view`（无界面命令，执行完给出结果提示），只有这两种取值 |
| `features` | 一个插件提供多个命令时使用。每项 `{ "code": "…", "explain": "命令名称" }`，可选 `mode`、`icon`、`alias`。入口模块按 `code` 导出对应的函数，见 [API 参考 · 写法](api.md#写法) |
| `alias` | 短别名，在搜索框输入它可以直接找到插件，不超过 32 个字符 |
| `keywords` | 额外的搜索关键字数组 |
| `draft` / `draftReason` | 草稿，见 [草稿](#草稿) |
| `revoked` / `revokedReason` | 下架，见 [下架](#下架) |
| `minAppVersion` | 最低客户端版本，见 [最低客户端版本](#最低客户端版本) |

Schema 里还有其他字段（如 `homepage`、`license`、`category`）。没有列在上表的字段，客户端不一定会用到，写之前先确认它确实生效。

## 版本号

**修改已有插件时必须升高 `version`**，否则合并前检查不通过。

原因：每个版本的安装包按「插件 ID + 版本号」命名，在 CDN 上缓存 30 天。同一个版本号换了内容，用户可能下载到旧的安装包，校验失败无法安装。

具体规则：

| 改动 | 要不要升版本 |
| --- | --- |
| 插件目录里除 `.md`、`.txt`、`LICENSE` 以外的任何文件（源码、清单、图标、测试） | 要，`主.次.修订` 必须比原来大（只改后缀不算） |
| 只改插件目录里的 `.md` / `.txt` / `LICENSE` | 不用 |
| 只是把插件标记为下架（`revoked: true`） | 不用 |
| 改了 `extensions/shared/` 里的公共源码 | 复制了这个文件的插件都要同步更新副本并升版本 |
| 改了 `scripts/`、`packages/`、工作流等公共部分 | 所有插件都会被重新检查，但不要求升版本 |

新插件从 `1.0.0` 开始即可。

## 平台声明

`targets` 声明插件能在哪些系统上运行。客户端不会显示当前系统不支持的插件，插件市场也据此标注「跨平台 / 仅 Windows / 仅 macOS」。

**只声明实际测试过的平台。**核心功能依赖 Windows 专有命令或系统接口的，只能写 Windows；macOS 同理。

跨平台：

```json
"targets": [
  { "id": "windows-electron-any", "platform": "windows", "runtime": "electron", "arch": "any" },
  { "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }
]
```

仅 Windows 或仅 macOS 时只保留对应的一项。创建插件时用 `--platform cross` / `windows` / `macos` 可以自动生成。

## 最低客户端版本

客户端低于插件目录里的 `minAppVersion` 时，插件市场不提供该插件的更新，安装前会提示用户先升级客户端。

一般不用手写：发布时脚本会检查插件的运行代码（`dist/`），用到较新的宿主接口就自动写入对应的版本，对照表在 `packages/ztools-plugins-spec/src/host-requirements.js`。插件确实依赖表里没有的新能力时，在 `plugin.json` 里写 `minAppVersion`（如 `"1.1.8.3"`），两者取较高的那个。`minZToolsVersion` 是插件 API 版本，客户端不会用它判断能不能安装。

插件用到旧客户端没有的接口，又能退回旧做法时（比如 `LocalStorage.updateItem` 不存在时改用读后写），优先在插件里兼容，见 `extensions/shared/host-compat.ts`，这样旧客户端也能继续更新这个插件。

## 草稿

功能还没做完（例如只有示例数据、某些操作还是假成功）但想先合并代码时，在清单里写：

```json
"draft": true,
"draftReason": "还没有接入真实的数据来源，目前只显示示例数据"
```

草稿插件在 CI 里照常编译、扫描和测试，但发布时不打包、不进插件目录，客户端也不会显示。做完后删掉这两个字段并升版本，下次发布时就会上架。

## 下架

**不要删除插件目录。**删除后已经安装的用户收不到任何通知，合并前检查也会直接拦下。

要下架插件时，保留目录，在清单里写：

```json
"revoked": true,
"revokedReason": "该插件依赖的服务已停止，请改用 xxx"
```

`revokedReason` 会显示给已安装的用户，写清楚原因和替代方案。下架后：

- 插件目录里只保留一条下架记录，不再提供下载；
- 客户端刷新插件目录后，自动禁用已安装的该插件；
- CI 不再编译、扫描和测试这个插件。

## 共用源码

`extensions/shared/` 里的 `hash.ts`、`native-ipc.ts`、`volume-ipc.ts`、`host-compat.ts` 以**复制**的方式进入各插件的 `src/`。插件里的副本必须与 `shared/` 里的原文件一字不差，否则编译直接失败。

修改公共源码时：先改 `extensions/shared/` 里的原文件，再复制到所有用到它的插件，并给这些插件升版本。`extensions/shared/test-harness.mjs` 是测试工具，测试里直接用相对路径引入，不需要复制。

## 合并前检查

PR 的 CI 会运行 `scripts/verify-changed-plugins.mjs`，检查项见 [审核标准 · CI 检查什么](review.md#ci-检查什么)。本地用同样的方式检查：

```bash
# 把官方 main 拉到本地 refs/remotes/upstream/main（Fork 仓库也可以用）
git fetch https://github.com/ZToolsTeam/ZTools-extensions.git main:refs/remotes/upstream/main
node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main

# 或者检查全部插件
node scripts/verify-changed-plugins.mjs --all
```

- 脚本按基线与当前分支 **HEAD 之间已提交的差异**判断哪些插件受影响，未提交的改动不算；但编译、扫描和测试读的是当前工作区。所以先提交，并保持工作区干净再运行。
- `npm test` 运行的是同一个脚本，基线固定为 `origin/main`，只在 `origin` 指向官方仓库时使用。

## 发布

PR 合并后由官方发布到插件市场。发布时 CI 会：

1. 从源码编译全部插件；
2. 逐个扫描、打包成 `<id>-<version>.zip`，计算 SHA-256；
3. 生成插件目录（草稿不进目录，下架的只保留下架记录），连同安装包一起上传到 CDN。

任何一个插件编译或扫描失败，整次发布都会中止，线上插件目录保持上一版不变。发布完成后，客户端刷新插件目录即可看到新版本。
