# 审核标准

插件以 Pull Request 的形式提交到本仓库，新插件和已有插件的每次更新都走同一套流程：

1. **CI 自动检查**：PR 一提交就会运行，不通过不能合并。
2. **官方人工审核**：维护者按本文的标准审阅代码和改动（更新只看本次的改动），必要时在 PR 里提出修改意见。
3. **合并**：审核通过后由维护者合并。
4. **发布**：PR 合并后由官方发布到插件市场。

## 上架前的四道关

| 关卡 | 做什么 |
| --- | --- |
| 人工审核 | 看功能是否真实可用、交互是否符合规范、命名是否清楚不重复、权限是否必要，见下文 |
| 清单校验与源码扫描 | CI 用 `plugin.schema.json` 校验清单（包括入口和图标路径不能越出插件目录），并对源码做静态扫描，见 [扫描规则](#扫描规则) |
| 从源码构建并校验 | 发布时由 CI 从源码重新编译、打包，不接受作者自己上传的编译产物；每个安装包的 SHA-256 写入插件目录，客户端下载后先校验再安装 |
| 下架开关 | 发现问题的插件会在清单里标记 `revoked`，客户端刷新插件目录后自动禁用已安装的副本，见 [发布规则 · 下架](publishing.md#下架) |

## 人工审核看什么

### 功能真实可用

- 有明确的使用场景，不接受占位示例或只有演示数据的插件。功能还没做完的，按 [发布规则 · 草稿](publishing.md#草稿) 标记 `draft`。
- **不造假**：拿不到真实数据时如实显示错误或空状态，不能用示例数据顶替，也不能在操作失败时提示成功。例如复制失败就不能提示「已复制」。
- 空结果、加载中、出错、无权限、离线这些状态都有明确的提示，不会白屏或卡住。
- 在 `targets` 声明的每个平台上都实际试用过，PR 里写明验证过的系统。

### 交互符合界面规范

按 [界面规范](ui-guidelines.md) 审核：用三种标准布局之一、动作顺序合理、没有彩色 Emoji 和无意义的彩色、同一功能不重复出现。扫描器的 `UI_*` 提示虽然不会让 CI 失败，但审核时会要求改掉；[提交前自检](ui-guidelines.md#提交前自检) 里扫描器查不出的两条（自造布局、详情栏重复列表内容）由审核人员检查。

### 命名清楚、不重复、不仿冒

- `name` 和 `description` 直接说明插件做什么，不夸大。
- 不与已有插件重复：功能相近的，优先改进已有插件。
- 不使用容易让人误认为是其他产品或官方出品的名称、图标和作者名。
- 插件市场的"官方"标记只给 `packages/ztools-plugins-spec/official-ids.json` 名单里的插件，由维护者维护；`author` 写官方名称的社区插件会被检查拦下。

### 权限必要

- 只申请实际用到的权限，PR 里说明每个权限用在哪里。
- 高危权限（`network`、`fs`、`shell`、`child_process`、`system`、`process`）会被重点审核。网络请求要在插件 README 里写明请求的域名和用途。
- 权限列表和含义见 [API 参考 · 权限](api.md#权限)。

### 代码质量

- 依赖的系统能力失败时（宿主报错、权限不足、超时），按错误码给出具体提示，不吞掉错误；不写空的 `catch {}`。
- 外部输入（用户输入、文件内容、网络响应、剪贴板内容）先校验再使用。
- 定时器、事件监听、轮询在 `useEffect` 的清理函数里释放；长时间的操作可以取消，视图关闭后不再更新状态。
- 不在代码、注释、日志和测试数据里写本机路径、用户名、令牌等个人信息。
- 测试覆盖正常结果、空结果、非法输入和依赖失败，而不只是正常流程。

客户端仓库的 [代码规范](https://github.com/ZToolsTeam/ZTools/blob/main/docs/coding-standards.md) 和 [测试](https://github.com/ZToolsTeam/ZTools/blob/main/docs/testing.md) 有更完整的说明，插件同样适用其中的通用原则。

## CI 检查什么

每个 PR 会运行两项检查：

```bash
node --test packages/ztools-plugins-spec/tests/*.test.mjs
node scripts/verify-changed-plugins.mjs --base origin/main
```

`verify-changed-plugins.mjs` 只检查本次改动涉及的插件，对每个插件依次检查：

1. 目录名与 `plugin.json` 的 `id` 一致，全仓库没有重复的 `id`；
2. 从源码编译成功（含类型检查）；
3. 清单校验和源码扫描没有错误；
4. 插件自带的 `tests/*.test.mjs` 全部通过；
5. 修改已有插件时版本号升高了；
6. 没有直接删除插件目录。

哪些改动算「涉及插件」、版本号怎么升，见 [发布规则 · 合并前检查](publishing.md#合并前检查)。

## 扫描规则

`node scripts/scan-plugin-security.mjs extensions/<id>` 会报告下面这些错误，任何一条都会让扫描失败（只扫源码，跳过 `tests/` 和 `*.test.*`、`*.spec.*` 文件）：

| 编号 | 含义 |
| --- | --- |
| `MISSING_PLUGIN_MANIFEST` / `INVALID_JSON_MANIFEST` | 没有 `plugin.json`，或它不是合法的 JSON |
| `MANIFEST_SCHEMA_VIOLATION` | 清单不符合 Schema：缺必填字段、格式不对、未知权限，或入口 / 图标文件不存在（先编译再扫描） |
| `BANNED_DYNAMIC_EVAL` | 使用 `eval`，包括 `window["ev" + "al"]` 这类拼接、计算属性或数组包装的间接调用，以及 `window[变量]()` 形式的反射调用 |
| `BANNED_DYNAMIC_FUNCTION` | 使用 `new Function()` / `Function()`，或通过 `({}).constructor.constructor(...)` 绕过 |
| `BANNED_DYNAMIC_REQUIRE` | `require()` 的参数不是固定的字符串 |
| `HEX_STRING_OBFUSCATION` / `OBFUSCATOR_VARIABLE_DETECTED` | 代码里有大量 `\x..` 转义或 `_0x…` 这类混淆特征。提交可读的源码，不要提交混淆或压缩过的代码 |
| `UNSUPPORTED_RUNTIME_MODULE` | 引入了声明式插件运行时不提供的 Node 内置模块（如 `fs`、`child_process`、`os`、`http`）。运行时只提供精简版 `crypto` 与 `path`（带不带 `node:` 前缀都一样），其余模块声明了权限也加载不了，见 [API 参考 · 可用模块](api.md#可用模块)；读写文件、执行命令请改用宿主 API |
| `UNAUTHORIZED_NODE_MODULE` | 引入了 Node 模块，但没声明对应权限 |
| `UNAUTHORIZED_NETWORK_CALL` | 调用了 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource`，但没声明 `network` 权限 |
| `UNAUTHORIZED_PROCESS_EXECUTION` | 调用了 `exec` / `spawn` 等进程执行方法，但没声明 `child_process` 权限 |
| `DISALLOWED_STYLE_FILE` / `DISALLOWED_INLINE_STYLE` / `DISALLOWED_DOM_STYLE_INJECTION` | 写了样式文件、内联样式，或在代码里注入样式，见 [界面规范 · 扫描器提示对照](ui-guidelines.md#扫描器提示对照) |
| `SYNTAX_PARSE_ERROR` / `NO_PARSER_AVAILABLE` | 源码无法解析，或没装依赖（先在仓库根目录 `npm ci --ignore-scripts`） |

扫描结果里的「需要重点人工审核」不是错误：它表示插件声明了高危权限或用到了网络、进程执行等敏感能力，审核时会逐项核对，请在 PR 里说明用途。
