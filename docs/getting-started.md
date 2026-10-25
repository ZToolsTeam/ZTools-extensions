# 开发入门

本文带你从零做出第一个插件：创建、编译、测试、在 ZTools 客户端里试用，再提交 Pull Request。示例插件 ID 用 `my-tool`，换成你自己的即可。

开始前可以先扫一眼 [界面规范](ui-guidelines.md)，它决定了你的插件该长什么样；写代码时查 [API 参考](api.md)。

## 1. 准备环境

- Node.js 24（与 CI 一致）和 Git。
- 一台装了 ZTools 客户端的 Windows 或 macOS 电脑，用来实际试用插件。

## 2. 克隆并安装依赖

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci --ignore-scripts
```

在仓库根目录安装一次即可。`npm ci --ignore-scripts` 按锁文件安装，和 PR 检查用的是同一条命令；SDK 通过 npm workspace 指向仓库里的 `packages/declarative-ui/`。

本文后面的命令都在仓库根目录执行。

## 3. 创建插件

```bash
npm run create-plugin -- my-tool "我的工具" "一句话说明插件做什么" --author "你的名字"
```

脚手架会生成 `extensions/my-tool/`：

| 文件 | 作用 |
| --- | --- |
| `plugin.json` | 插件清单：名称、版本、入口、图标、权限、支持的平台 |
| `src/index.tsx` | 界面：一个可搜索的短语列表，回车复制 |
| `src/items.ts` | 示例数据和过滤逻辑，和界面分开，方便测试 |
| `tests/index.test.mjs` | 测试：清单、过滤逻辑（含异常输入）、渲染结果 |
| `icon.svg` | 单色图标 |
| `tsconfig.json` | 编译配置，指向仓库里的 SDK 类型声明 |
| `package.json` | 只用来把编译产物标成 ES 模块，不需要装依赖 |
| `README.md` | 插件说明 |

生成的 `plugin.json`：

```json
{
  "id": "my-tool",
  "name": "我的工具",
  "version": "1.0.0",
  "description": "一句话说明插件做什么",
  "author": "你的名字",
  "entry": "dist/index.js",
  "icon": "icon.svg",
  "mode": "view",
  "permissions": ["clipboard"],
  "targets": [
    { "id": "windows-electron-any", "platform": "windows", "runtime": "electron", "arch": "any" },
    { "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }
  ],
  "nativeComponents": []
}
```

常用选项：

| 选项 | 说明 |
| --- | --- |
| `--platform cross` / `windows` / `macos` | 生成哪些平台的 `targets`，默认 `cross`（两个平台都写）。按你实际能测试的平台选 |
| `--author <名字>` | 作者，默认 `ZTools Developer` |
| `--force` | 目录已存在时覆盖 |
| `--help` | 查看全部用法 |

插件 ID 以小写字母开头，只用小写字母、数字和短横线，长度 2–64，例如 `quick-notes`。ID 一旦发布就不要再改，它也是目录名。

不带参数运行 `npm run create-plugin` 会逐项询问。

## 4. 看懂示例代码

`src/index.tsx` 的核心部分：

```tsx
import React, { List, ActionPanel, Action, Icon, Clipboard, showToast, Toast, useState } from "@ztools/declarative-ui";
import { SAMPLE_ITEMS, filterItems } from "./items.js";

export default function Command() {
  const [searchText, setSearchText] = useState<string>("");
  const items = filterItems(SAMPLE_ITEMS, searchText);

  return (
    <List searchBarPlaceholder="搜索短语" searchText={searchText} onSearchTextChange={setSearchText}>
      {items.map((item) => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={item.content}
          icon={Icon.Text}
          accessories={[{ tag: item.category }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="复制内容" content={item.content} />
              <Action title="复制标题" icon={Icon.CopyClipboard} onAction={async () => { /* … */ }} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
```

几个要点：

- **默认导出的函数就是插件入口**，返回一个声明式视图（这里是 `List`）。
- **所有东西都从 `@ztools/declarative-ui` 引入**，包括 `React` 和 `useState` 等 Hook。不能引入第三方 npm 包，原因见 [API 参考 · 可用模块](api.md#可用模块)。
- **动作的顺序有含义**：`ActionPanel` 里第 1 个动作是回车（`Enter`）触发的主动作，第 2 个是 `⌘/Ctrl+Enter` 触发的次动作，其余收进 `⌘/Ctrl+K` 打开的动作面板。
- **相对路径引入要写 `.js` 后缀**（`./items.js`），因为编译后是 `dist/items.js`。

示例是最简单的「单栏列表」。你的插件该用哪种布局，按 [界面规范 · 选择布局](ui-guidelines.md#选择布局) 判断；仓库里的现成插件（例如 [`extensions/process-monitor`](../extensions/process-monitor/)、[`extensions/disk-analyzer`](../extensions/disk-analyzer/)、[`extensions/screenshot`](../extensions/screenshot/)）可以直接参考。

## 5. 编译

```bash
node scripts/build-declarative.mjs my-tool
```

编译结果在 `extensions/my-tool/dist/`。需要知道的几点：

- 每次编译前会清空 `dist/`，改代码只改 `src/`。`dist/` 不提交，CI 会从源码重新编译。
- 编译用仓库锁定版本的 TypeScript，类型错误会让编译失败。
- 每个源文件单独编译，不做打包，所以插件里只能引入 `@ztools/declarative-ui` 和自己的相对路径文件。
- 插件复制了 `extensions/shared/` 里的公共源码时，副本必须和原文件完全一致，否则编译直接失败。

## 6. 检查与测试

```bash
node scripts/scan-plugin-security.mjs extensions/my-tool
node --test extensions/my-tool/tests/*.test.mjs
```

- **扫描**：校验 `plugin.json`，并对源码做安全扫描（禁止 `eval`、混淆代码、未声明权限的网络请求等）。清单校验会检查入口文件是否存在，所以要先编译再扫描。扫描还会给出 `UI_*` 开头的界面规范提示，含义见 [界面规范 · 扫描器提示对照](ui-guidelines.md#扫描器提示对照)。
- **测试**：测试读取的是 `dist/` 里的编译产物，改完源码要先重新编译。

脚手架生成的测试只是起点。写真实功能时，至少补上这几类用例：正常结果、空结果、输入不合法、依赖的系统能力失败（例如剪贴板写入失败、宿主方法报错）。`extensions/shared/test-harness.mjs` 提供了一个模拟客户端，可以在 Node 里渲染插件、执行动作、注入故障：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, mount } from "../../shared/test-harness.mjs";
import Command from "../dist/index.js";

test("搜索没有结果时列表为空", async () => {
  createHost();
  const view = await mount(Command);
  await view.search("不存在的关键字");
  assert.equal(view.items().length, 0);
  view.unmount();
});

test("复制标题：写入剪贴板并提示成功", async () => {
  const host = createHost();
  const view = await mount(Command);
  await view.run(view.item("thanks"), "复制标题");
  assert.equal(host.clipboard.text, "收到，谢谢");
  assert.equal(host.lastToast().title, "已复制标题");
  view.unmount();
});
```

`createHost()` 返回的对象里，`host.faults.storageRead` / `storageWrite` 可以让存储读写失败，`host.ipc.<方法名>` 可以给宿主方法指定返回值或抛错。更多用法参考其他插件的 `tests/` 目录。

## 7. 在 ZTools 客户端里试用

自动化测试通过后，还要在真实客户端里走一遍：正常操作、空结果、出错时的提示，键盘操作是否顺手。

做法是**用一个单独的数据目录启动客户端**，把编译好的插件复制进去。这样不会影响你日常使用的设置和已装插件，用完删掉这个目录即可（macOS 上 Electron 自身的少量配置仍会写在系统默认位置，试用前先退出正在运行的 ZTools）。

### 第一步：复制插件

客户端会加载数据目录下 `Plugins/<插件 ID>/` 里的插件，需要复制 `plugin.json`、`dist/` 和图标三样。

macOS：

```bash
DATA="$HOME/ztools-plugin-dev/Data"
rm -rf "$DATA/Plugins/my-tool"
mkdir -p "$DATA/Plugins/my-tool"
cp -R extensions/my-tool/plugin.json extensions/my-tool/icon.svg extensions/my-tool/dist "$DATA/Plugins/my-tool/"
```

Windows（PowerShell）：

```powershell
$data = "$env:USERPROFILE\ztools-plugin-dev\Data"
$dest = "$data\Plugins\my-tool"
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item extensions\my-tool\plugin.json, extensions\my-tool\icon.svg $dest
Copy-Item -Recurse extensions\my-tool\dist $dest
```

### 第二步：用这个数据目录启动客户端

先退出正在运行的 ZTools：同一时间只能运行一个 ZTools，否则新启动的会立即退出。

macOS（客户端装在「应用程序」里）：

```bash
/Applications/ZTools.app/Contents/MacOS/ZTools --data-root="$DATA"
```

Windows（把路径换成 ZTools 的安装目录；免安装版就是解压目录）：

```powershell
& "<ZTools 安装目录>\ZTools.exe" "--data-root=$data"
```

参数必须写成 `--data-root=<目录>` 这种带等号的形式，目录用绝对路径。数据写在这个目录里，日志和缓存写在它的上一级目录（上面的例子是 `ztools-plugin-dev/`）。

如果你在本地运行 ZTools 客户端的源码，同样加 `--data-root`，见客户端仓库的 [测试 · 手动验证](https://github.com/ZToolsTeam/ZTools/blob/main/docs/testing.md#手动验证)。

### 第三步：打开插件

在 ZTools 搜索框里输入插件名称（例子里是「我的工具」），回车打开。

改了代码之后：重新编译 → 重新执行第一步复制 → 退出客户端再用同样的命令启动。客户端会在内存里缓存已经加载过的插件代码，不重启可能还在运行旧版本。

### 插件没有出现时

| 检查 | 说明 |
| --- | --- |
| 目录名与 `id` 一致 | `Plugins/` 下的目录名必须等于 `plugin.json` 里的 `id` |
| 复制的是真实文件 | 符号链接（`ln -s`、快捷方式）会被忽略，要复制文件 |
| `targets` 包含当前系统 | 清单里没声明当前平台的插件不会显示 |
| `author` 不要写官方名称 | 作者写成 `ZTools`、`ZTools Team`、`official` 等官方名称、但又不是官方发布的插件会被隐藏 |
| ID 不是客户端内置插件 | 随客户端内置的插件（目前是 `json-format`、`timestamp`、`calculator`、`qr-code`、`base64image`、`file-compare`、`crypto-tool`、`google-auth`、`color-picker`、`memo`、`todo`）总是加载客户端自带的那份，复制到 `Plugins/` 不生效。修改这些插件时，可以在复制出来的 `plugin.json` 里临时改一个新 ID（目录名同步改），作者改成你自己的名字再试用；提交时不要带上这些临时改动 |
| ID 没有和客户端内置功能重名 | 客户端内置功能占用了一些 ID（名单见 [`packages/ztools-plugins-spec/reserved-ids.json`](../packages/ztools-plugins-spec/reserved-ids.json)），社区插件用了这些 ID 会被隐藏。清单校验会直接拒绝它们，换一个 ID 即可 |
| 看错误信息 | 启动命令再加 `--remote-debugging-port=9222`，用 Chrome 打开 `chrome://inspect` 连接后，在控制台查看插件加载和运行时的报错 |

## 8. 提交 Pull Request

1. Fork 本仓库，在自己的分支上提交 `extensions/my-tool/` 下的源码、清单、图标和测试（`dist/` 已被忽略，不用管）。
2. 按 [贡献指南](../CONTRIBUTING.md) 跑一遍合并前检查。
3. 发起 Pull Request，按模板写清楚改了什么、在哪些系统上验证过、为什么需要这些权限。

审核会看什么见 [审核标准](review.md)；版本号、平台声明、草稿和下架的规则见 [发布规则](publishing.md)。PR 合并后由官方发布到插件市场。
