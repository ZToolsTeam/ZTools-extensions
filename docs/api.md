# API 参考

插件只依赖一个包：`@ztools/declarative-ui`。它提供界面组件、Hook 和常用系统能力（提示、剪贴板、存储等）。本文按用途介绍每一项能做什么、有哪些要注意的地方；**准确的类型签名以 [`packages/declarative-ui/dist/`](../packages/declarative-ui/dist/index.d.ts) 里的 `.d.ts` 为准**，编辑器里悬停也能看到。

界面该怎么搭（选哪种布局、动作怎么排）见 [界面规范](ui-guidelines.md)，本文只讲 API 本身。

- [写法](#写法)
- [可用模块](#可用模块)
- [组件](#组件)
- [Hook](#hook)
- [系统能力](#系统能力)
- [客户端宿主 API（window.ztools）](#客户端宿主-apiwindowztools)
- [权限](#权限)
- [测试用的 API](#测试用的-api)

## 写法

```tsx
import React, { Detail, ActionPanel, Action, useState } from "@ztools/declarative-ui";

export default function Command() {
  const [count, setCount] = useState(0);
  return (
    <Detail
      markdown={`点击次数：${count}`}
      actions={
        <ActionPanel>
          <Action title="加一" onAction={() => setCount((n) => n + 1)} />
        </ActionPanel>
      }
    />
  );
}
```

- `plugin.json` 的 `entry`（通常是 `dist/index.js`）指向的模块，**默认导出的函数就是插件入口**。
- JSX 编译成 `React.createElement`，所以用了 JSX 的文件要引入 `React`（同样来自 `@ztools/declarative-ui`，不是 npm 上的 react 包）。
- 组件也可以不用 JSX，直接当函数调用：`List.Item({ title: "…" })`、`List({ … }, ...children)`，仓库里不少 `.ts` 插件就是这样写的。
- 有多个命令的插件，在清单里写 `features`（见 [发布规则 · 清单字段](publishing.md#清单字段)），入口模块里按 `code` 导出同名函数（也认 camelCase、PascalCase 和 `<名字>Command` 写法）；找不到时使用默认导出。

## 可用模块

插件运行在客户端界面里，加载时只认下面这些模块，其他一律拒绝（报 `UNAUTHORIZED_MODULE_ACCESS`）。构建时每个文件单独编译、不做打包，所以**第三方 npm 包无论装没装都用不了**，需要的逻辑请自己实现或放进插件源码。

| 引入 | 得到什么 |
| --- | --- |
| `@ztools/declarative-ui` | 全部组件、Hook 和系统能力 |
| `./文件名.js` | 插件自己的其他源文件 |
| `crypto` / `node:crypto` | 精简版：`createHash` / `createHmac`（md5、sha1、sha256）、`randomBytes`（最多 65536 字节）、`randomUUID`；加解密接口不可用。也可以直接用浏览器的 `globalThis.crypto`（WebCrypto） |
| `path` / `node:path` | 精简版：`join`、`resolve`、`dirname`、`basename`、`extname`（只做字符串拼接，统一用 `/`） |

`fs` 等 Node 模块不在其中，引入同样会被拒绝（声明了 `fs` 权限也一样）。读写文件请用 [宿主 API](#客户端宿主-apiwindowztools) 的 `ztools.fs`。

相对路径的规则：

- 只能用 `./` 开头，不能用 `../`。
- 路径一律相对入口文件所在的目录（`dist/`）解析，而不是相对当前文件。所以**源文件都放在 `src/` 同一层**，用 `./logic.js` 这样的路径互相引入；后缀写 `.js`。

## 组件

### List

搜索框 + 列表，三种标准布局都基于它。

| 属性 | 说明 |
| --- | --- |
| `searchText` / `onSearchTextChange` | 搜索框内容。**客户端不会替你过滤列表**，要支持搜索就在 `onSearchTextChange` 里自己过滤 |
| `searchBarPlaceholder` | 搜索框占位文字 |
| `searchBarAccessory` | 搜索框右侧的控件，放一个 `List.Dropdown` 做筛选、排序或数据源切换 |
| `isLoading` | 显示加载状态 |
| `navigationTitle` | 页面标题 |
| `isShowingDetail` | 是否显示右侧预览栏，内容取自选中项的 `detail` |
| `selectedItemId` / `onSelectionChange` | 控制或监听当前选中项（按 `List.Item` 的 `id`） |
| `filterBar` | 搜索框下方的单行状态条：`{ summaryText, actions }`，`actions` 每项 `{ id, title, icon?, onAction }`，最多放 2 个全局动作 |
| `subList` | 布局二、三的右栏明细：`{ title?, subtitle?, emptyText?, checkable?, checked?, onCheckChange?, items }`，`items` 是 `List.Item` 数组 |
| `workbenchPanel` | 布局三的左栏参数：`{ title?, subtitle?, fields, previewCard? }`，`fields` 每项 `{ id, label, type: "select" \| "toggle" \| "text" \| "info", value, options?, onChange? }` |
| `actions` | 没有选中项（例如列表为空），或选中项没有自己的 `actions` 时，底部使用的动作 |

`metricGrid`、`distributionBar`、`segmentedControl`、`header` 等属性在类型里也有，其中 `metricGrid`、`distributionBar` 按规范不能用，原因见 [界面规范 · 属性约定](ui-guidelines.md#属性约定)。

**`List.Item`**

| 属性 | 说明 |
| --- | --- |
| `id` | 行的唯一标识，选中、测试都靠它 |
| `title` / `subtitle` | 标题和副标题 |
| `icon` | 图标，用 `Icon.*` |
| `accessories` | 行右侧的信息，数组，每项可以是 `{ text }`、`{ tag }`、`{ progress: 0~1 }`、`{ icon }`、`{ date }`，可带 `tooltip`。`text` / `tag` / `progress` 也可写成 `{ value, color }`，颜色只用于高危告警 |
| `keywords` | 额外的搜索关键字（供你自己的过滤逻辑使用） |
| `actions` | 选中这一行时的动作，放一个 `ActionPanel` |
| `detail` | 右侧预览内容，配合 `isShowingDetail` 使用，通常是一个 `Detail` |
| `checkable` / `checked` / `onCheckChange` | 可勾选行，`checked` 可以是 `"indeterminate"` |
| `onSelect` | 被点击或在左侧导航里被选中时调用（布局二用来切换右侧明细） |

**`List.Section`**：分组，属性 `title`、`subtitle`，可带 `checkable` / `checked` / `onCheckChange` 做分组全选。

**`List.Dropdown`**：属性 `value` / `defaultValue`、`onChange(value)`、`tooltip`，子元素是 `List.Dropdown.Item`（`title`、`value`、`icon`）和 `List.Dropdown.Section`。

### Detail

一篇 Markdown，可选右侧属性栏。属性：`markdown`、`navigationTitle`、`isLoading`、`actions`、`metadata`。

`metadata` 放一个 `Detail.Metadata`，子元素可以是：

| 组件 | 属性 |
| --- | --- |
| `Detail.Metadata.Label` | `title`、`text`、`icon` |
| `Detail.Metadata.Link` | `title`、`target`（链接地址）、`text` |
| `Detail.Metadata.TagList` | `title`，子元素 `Detail.Metadata.TagList.Item`（`text`、`icon`、`color`） |
| `Detail.Metadata.Separator` | 分隔线 |

### Form

表单页，属性 `navigationTitle`、`isLoading`、`actions`。字段：

| 组件 | 主要属性 |
| --- | --- |
| `Form.TextField` / `Form.PasswordField` | `id`、`title`、`placeholder`、`value` / `defaultValue`、`onChange`、`error`、`info`、`autoFocus` |
| `Form.TextArea` | `id`、`title`、`placeholder`、`value` / `defaultValue`、`onChange`、`error`、`info` |
| `Form.Checkbox` | `id`、`title`、`label`、`value` / `defaultValue`、`onChange` |
| `Form.Dropdown` | `id`、`title`、`value` / `defaultValue`、`onChange`、`error`、`info`，子元素 `Form.Dropdown.Item`（`title`、`value`、`icon`）、`Form.Dropdown.Section` |
| `Form.Description` | `title`、`text`，一段说明文字 |
| `Form.Separator` | 分隔线 |

提交用 `Action.SubmitForm`：`onSubmit(values)` 收到的 `values` 以字段 `id` 为键。表单里 `⌘/Ctrl+Enter` 执行第一个动作。

### ActionPanel 与 Action

`ActionPanel` 装一组动作，可以用 `ActionPanel.Section`（`title`）分组、`ActionPanel.Submenu`（`title`、`icon`）做子菜单。第 1 个动作是 `Enter` 主动作，第 2 个是 `⌘/Ctrl+Enter` 次动作，其余在 `⌘/Ctrl+K` 动作面板里。

每个动作都可以带 `title`、`icon` 和 `shortcut`（`{ modifiers: ["cmd" | "ctrl" | "opt" | "alt" | "shift"], key }`，`cmd` 和 `ctrl` 都表示 macOS 的 `⌘`、Windows 的 `Ctrl`）。

| 动作 | 客户端做什么 |
| --- | --- |
| `Action` | 调用 `onAction`。`onAction` 抛错时客户端显示「操作失败」和错误信息，不需要自己再包一层提示；`style: Action.Style.Destructive` 标记危险操作 |
| `Action.CopyToClipboard` | 把 `content` 写入剪贴板并提示「已复制到剪贴板」，然后调用 `onCopy` |
| `Action.Paste` | 把 `content` 粘贴到前台应用。macOS 需要用户给 ZTools 授予辅助功能权限，粘贴失败时会如实提示 |
| `Action.OpenInBrowser` | 用系统默认浏览器打开 `url` |
| `Action.ShowInFinder` | 在文件管理器（访达 / 资源管理器）中显示 `path` |
| `Action.OpenWith` / `Action.Open` | 用系统默认程序打开 `path` |
| `Action.Push` | 打开 `target` 指定的下一级视图，`Esc` 返回 |
| `Action.SubmitForm` | 收集表单值，调用 `onSubmit(values)` |

### 图标与颜色

- `Icon`：一组单色线性图标（`Icon.Text`、`Icon.Folder`、`Icon.Trash`、`Icon.Gear`……），完整列表见 [`constants/icons.d.ts`](../packages/declarative-ui/dist/constants/icons.d.ts)。
- `Color`：`Color.Red` 等颜色常量。按规范只在高危告警时使用 `Color.Red`。

## Hook

| Hook | 用途 |
| --- | --- |
| `useState`、`useEffect`、`useMemo`、`useCallback`、`useRef` | 与 React 同名 Hook 的用法一致。`useEffect` 返回的清理函数会在视图卸载时执行，定时器、监听器要在这里清理 |
| `useNavigation()` | 返回 `{ push(view), pop() }`，在代码里打开下一级视图或返回 |
| `usePromise(fn, args?, options?)` | 执行异步函数，返回 `{ data, error, isLoading, revalidate, mutate }` |
| `useCachedPromise(fn, args?, options?)` | 同上，结果放在本插件的内存缓存里，重新进入时先显示上次的数据 |
| `useFetch(url, options?)` | 发 HTTP 请求并解析结果（需要 `network` 权限，见下方「网络请求」） |
| `useCachedState(key, initialValue, options?)` | 带内存缓存的状态，缓存同样只属于本插件；`options.cache` 可指定自己创建的 `Cache` |
| `usePopoutState(key, initialValue)` | 和 `useState` 一样，但用户把插件「弹出到独立窗口」时状态会带过去 |

## 系统能力

| API | 说明 |
| --- | --- |
| `showToast(style, title, message?)` 或 `showToast({ style, title, message })` | 轻提示。`style` 用 `Toast.Style.Success` / `Failure` / `Animated`。返回的句柄可以改 `title`、`message`、`style` 或 `hide()` |
| `showHUD(title)` | 简短的成功提示。客户端里显示为一条成功样式的轻提示（与 `showToast` 的 `Success` 相同），约 1.5 秒后自动消失 |
| `confirmAlert({ title, message?, primaryAction?, dismissAction? })` | 客户端内的确认框，返回用户是否点了确认。危险操作把 `primaryAction.style` 设为 `"destructive"` |
| `Clipboard.copy(content)` / `paste(content)` / `readText()` / `clear()` | 剪贴板。`copy` 失败（内容为空、超过 8 MiB、剪贴板被占用）会抛错，失败时不要提示「已复制」 |
| `LocalStorage.getItem` / `setItem` / `removeItem` / `allItems` / `clear` | 插件私有的持久存储，按插件 ID 隔离，重启不丢。key 为 1–200 个字符，单个值不超过 4 MiB，值按 JSON 保存 |
| `SecureStorage` | 用系统钥匙串加密保存密钥、令牌等机密，值不超过 64 KiB。加密不可用时 `setItem` 直接报错，不会退回明文；先用 `status()` 检查是否可用。它防的是磁盘和其他程序读到明文，不能防同一客户端里的其他插件 |
| `Cache` | 内存缓存（`get` / `set` / `has` / `remove` / `clear` / `subscribe`），客户端重启后清空。按插件 ID 隔离，其他插件读不到；`new Cache({ namespace })` 的 `namespace` 只用来在本插件内部再分组 |
| `open(target)` | 用系统默认浏览器打开链接 |
| `terminateProcess(pid, options?)` | 结束本机进程，需要 `process` 权限。`options`：`mode`（`graceful` / `force`）、`tree`、`timeoutMs`、`expectedName`（与当前进程名不一致时拒绝，防止 PID 被复用后误杀） |
| `ZToolsHostError` / `isZToolsHostError(err)` | 客户端能力调用失败时抛出的错误类型，`err.code` 是错误码（如 `PROCESS_PROTECTED`、`PLUGIN_PERMISSION_REQUIRED`），按错误码给用户具体提示 |
| `getHostTransport()` | 带本插件身份的底层宿主调用通道，`call(method, params)` 返回宿主的原始响应。一般用不到，优先用上面封装好的 API |

### 多窗口并发存储

`LocalStorage` 和 `SecureStorage` 都提供下面两个方法，作用范围仍是当前插件。用于同一插件的多个窗口可能同时修改一个值的场景，避免「读取后直接 `setItem`」覆盖另一个窗口的修改。

| 方法 | 语义 |
| --- | --- |
| `compareAndSet(key, expected, value): Promise<boolean>` | 仅当当前值与 `expected` 的 JSON 序列化文本一致时，原子写入 `value` 并返回 `true`；不一致返回 `false`，不写入。`expected === undefined` 表示该 key 不存在，与已保存的 JSON `null` 不同 |
| `updateItem(key, update): Promise<T>` | 读取当前值，调用 `update(current)` 生成新值，再尝试原子保存；冲突时重新读取并重新调用回调，最多尝试 8 次。成功返回保存后的值；连续冲突抛 `STORAGE_CONFLICT`。回调结果的 JSON 没有变化时不写入 |

`update` 必须是同步、可重复执行的纯数据转换函数，不能发请求、复制内容、弹提示或修改回调以外的状态。可以修改传入的对象或数组后将其返回，这种修改也会保存；不能只修改而不返回值。需要执行的外部动作放在 `await updateItem(...)` 成功之后。例如：

```ts
await LocalStorage.updateItem('launch-count', current =>
  typeof current === 'number' ? current + 1 : 1
)
```

新值必须可用 JSON 序列化，key 与值大小限制和 `setItem` 一致。`SecureStorage` 的 key 为 1–128 个字符，以字母或数字开头，其余只允许字母、数字、`.`、`_`、`:`、`-`。宿主不支持原子存储、取消、加密或写入失败都会报错；不能将这些错误当作并发冲突，也不能回退为普通 `getItem` + `setItem`。

### 网络请求

`fetch`、`useFetch` 在客户端界面环境中发起请求，受浏览器跨域规则限制。用到网络必须在 `plugin.json` 声明 `network` 权限，并在插件 README 里写清楚请求哪些域名、做什么用。扫描器能发现直接调用的 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`，发现不了 `useFetch` 这类间接调用，但规则一样：用了就要声明。

## 客户端宿主 API（window.ztools）

SDK 没有封装的系统能力（读写文件、系统对话框、截图、系统信息等），可以调用客户端提供的全局对象 `window.ztools`。完整的方法和类型见客户端仓库的 [`packages/api/types/index.d.ts`](https://github.com/ZToolsTeam/ZTools/blob/main/packages/api/types/index.d.ts)。插件常用的命名空间：

| 命名空间 | 用途 |
| --- | --- |
| `ztools.fs` | 读写、复制、移动、删除文件，列目录 |
| `ztools.win` | 打开文件 / 保存文件 / 选择文件夹对话框 |
| `ztools.shell` | 打开文件或链接、在文件管理器中显示、移到回收站 |
| `ztools.sys` | 平台判断、系统路径、硬件与资源占用信息、系统通知 |
| `ztools.clipboard` | 剪贴板的文本、图片和文件 |
| `ztools.screen` / `ztools.screenshot` | 截屏、显示器信息 |
| `ztools.process` | 进程与端口列表 |
| `ztools.network` | 由客户端发起的 HTTP 请求、下载 |
| `ztools.db` | 键值与文档存储（新插件优先用 SDK 的 `LocalStorage`） |
| `ztools.ocr`、`ztools.image`、`ztools.zip` | 文字识别、图片处理、压缩包 |

使用时注意：

- **只在真实客户端里存在**。在 Node 测试里没有 `window.ztools`，代码要先判断是否存在，不存在时如实报错或在测试里用替身，不能返回假数据。
- **不是每个方法在每个平台都可用**，按 `targets` 声明的平台逐一实测。
- 调用要与声明的权限对应（例如读写文件对应 `fs`，执行命令对应 `shell` 或 `child_process`），审核时会逐项核对。
- 类型里未列在上表的命名空间（更新、统计、账号、特权操作等）供客户端自身使用，插件不要调用。

### 挂载卷、剪贴板历史与安全改名

下面的方法通过 `getHostTransport().call(method, params)` 调用。表中结果指成功响应的 `data`；调用失败必须显示错误，不能吞掉错误再返回空数组或成功提示。

| 方法与参数 | 成功结果与边界 |
| --- | --- |
| `system_list_volumes`，`{}` | Windows / macOS 返回 `{ volumes, partial, errors }`。`volumes` 为系统枚举到的已挂载磁盘卷；`partial: true` 表示部分卷读取失败，`errors: string[]` 给出原因，此时不能把列表或容量汇总展示成完整结果。整体枚举失败会报错 |
| `clipboard_history_restore`，`{ id, paste? }` | `id` 必须来自宿主 `clipboard_history_query` 返回的历史条目（1–64 个字符），不能使用插件自建历史 ID 或传入文件路径、文本、图片内容。按原始文本 / 图片 / 文件类型恢复剪贴板；`paste: true` 还会隐藏窗口并向目标应用粘贴，默认仅恢复。成功返回 `{ success: true }`；条目失效、原文件不可访问或粘贴失败都会报错 |
| `filesystem_move_file_no_replace`，`{ sourcePath, destPath }` | 路径参数版本仅适用于 SDK Contract 1。要求源和目标都有写授权，由原生文件组件原子拒绝覆盖已存在目标，成功返回 `{ success: true }`。缺少原生组件明确报错，不会降级为可能覆盖文件的移动。当前不支持仅修改文件名大小写；完全相同的源、目标路径为空操作 |
| `filesystem_get_directory_contents`，`{ path }` | SDK Contract 1 的路径参数版本返回 `{ success: true, files, writeAuthorized }`。列目录成功只表示有读授权；`writeAuthorized` 表示当前目录是否另有写授权。为 `false` 时应先让用户通过目录选择授权再改名，不能由「可读取」推断「可修改」。即使为 `true`，具体写操作仍可能因系统权限或目录变化失败 |

每个卷的字段：

| 字段 | 类型与含义 |
| --- | --- |
| `path` | `string`，真实挂载路径，可能是盘符根目录或目录挂载点 |
| `label` | `string`，卷名称 |
| `fileSystem` | `string`，文件系统名称；未知时为空字符串 |
| `totalBytes` / `usedBytes` / `availableBytes` | `number`，总容量、已用容量、当前可用容量，单位为字节；系统保留空间可能使已用与可用之和小于总容量 |
| `capacityGroup` | `string`，共享容量标识；例如同一 APFS 容器的多个卷共享容量。汇总时每组只计一次，不要把同组卷逐个累加 |

SDK Contract 2 的文件方法使用授权引用，不能向上面的路径参数版本传原始路径；安全移动使用该通道的 `filesystem_move_file`，指定 `replace: false`。恢复剪贴板后若粘贴失败，剪贴板内容可能已经恢复，应区分这两个步骤的结果。

## 权限

`plugin.json` 的 `permissions` 列出插件用到的能力。它首先是给审核人员和用户看的申报清单：**用到什么就声明什么，用不到的不要声明**。

| 权限 | 用途 | 高危 |
| --- | --- | --- |
| `network` | 发起网络请求 | 是 |
| `clipboard` | 读写剪贴板、粘贴到前台应用 | |
| `dialog` | 系统文件选择、保存对话框 | |
| `notification` | 系统通知 | |
| `shell` | 打开文件或链接、在文件管理器中显示、执行命令 | 是 |
| `fs` | 读写本机文件 | 是 |
| `child_process` | 启动外部程序或命令 | 是 |
| `database` | 使用客户端提供的数据存储 | |
| `sqlite` | 读取 SQLite 数据库文件 | |
| `system` | 读取系统信息、电源与系统设置相关操作 | 是 |
| `screen` | 截屏、读取显示器信息 | |
| `tray` | 系统托盘相关能力 | |
| `crypto` | 引入 `crypto` 模块 | |
| `audio` | 录音或音频处理 | |
| `video` | 录屏、摄像头或视频处理 | |
| `process` | 结束本机进程（`terminateProcess`） | 是 |

这些权限目前在哪里被检查：

- **扫描器（提交时）**：用了 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` 却没声明 `network`，用了 `exec` / `spawn` 等进程执行方法却没声明 `child_process`，引入 Node 模块却没声明对应权限（`fs`、`child_process`、`network`、`crypto`、`system`），都会报错。声明了高危权限的插件会被标记为「需要重点人工审核」，PR 里要逐项说明用途。声明权限只是让扫描通过：运行时仍然只能引入上面[可用模块](#可用模块)表里的模块，执行命令、读写文件请用宿主提供的接口。
- **客户端（运行时）**：`process` 权限由客户端强制检查，没声明时 `terminateProcess` 报 `PLUGIN_PERMISSION_REQUIRED`；只有声明了 `fs` 的插件，才能把客户端文件搜索或目录扫描返回的文件移到回收站。
- **审核人员**：其余权限由人工对照代码核对。插件和客户端界面运行在同一个 JavaScript 环境里，运行时没有完整的权限隔离，所以审核时会严格看权限是否必要、用法是否和说明一致。

## 测试用的 API

在 Node 里测试插件时会用到：

| API | 说明 |
| --- | --- |
| `renderDeclarativeRoot(Command)` | 渲染插件，返回 `{ getLatest(), forceRender(), unmount() }`，`getLatest()` 得到视图描述对象（`type`、`props`、`children`） |
| `setDeclarativeBridge(bridge)` | 替换客户端能力的实现（提示、剪贴板、存储、导航等），用来模拟成功或失败 |
| [`extensions/shared/test-harness.mjs`](../extensions/shared/test-harness.mjs) | 基于上面两个 API 的现成模拟客户端：`createHost()`、`mount(Command)`、`tick()`，支持搜索、执行动作、注入存储和宿主方法故障，用法见 [开发入门 · 检查与测试](getting-started.md#6-检查与测试) |
