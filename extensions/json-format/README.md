# JSON 格式化与类型推导 (json-format)

基于 ZTools 最新纯声明式 UI 架构与 Raycast 兼容组件库开发的 JSON 工具插件。

## 功能亮点
- **零 CSS 样式与零 HTML**：完全基于 `@ztools/raycast-compat` 声明式组件构建，由宿主统一渲染 Fluent / Mica 亚克力亚态毛玻璃；
- **智能校验与即时格式化**：实时校验 JSON 语法，支持 2 格与 4 格缩进风格切换；
- **一键压缩与剪贴板联动**：一键从剪贴板读取，支持一键复制美化版、压缩单行版或导出的类型定义；
- **TypeScript 接口推导**：基于输入 JSON 深度递归推导规范的 TypeScript `interface` / `type` 结构；
- **全键盘极客闭环**：`Enter` 提交解析并推入详情栈，`Ctrl+K` 唤起操作抽屉，`Esc` 快速返回。
