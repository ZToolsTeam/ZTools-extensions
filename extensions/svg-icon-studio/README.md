# SVG预览与压缩

在本机校验、清理静态 SVG，并导出清理后的 SVG、React TSX 组件、Vue 3 SFC 组件或 Data URI。

## 使用

- 命令：`svg`、`svgo`、`svg压缩`、`SVG预览`、`图标转换`。
- Enter 从剪贴板载入 SVG；⌘/Ctrl+Enter 打开多行源码编辑器，粘贴或修改后再按 ⌘/Ctrl+Enter 校验并生成，Esc 放弃修改。已有结果时，用顶部「载入剪贴板」「编辑源码」重新输入。
- 右侧详情顶部显示清理后 SVG 的图片预览（按图片渲染，不执行脚本），下面是对应格式的代码。
- 用上下方向键选择导出格式，Enter 复制；Data URI 一行的 ⌘/Ctrl+Enter 复制 Base64 形式。搜索框只筛选导出格式，不用于输入源码，以免丢失原有换行。
- 所有格式保留文字、空白、ID 和坐标数值精度；删除注释和 XML 声明，整理属性写法，体积可能减少也可能增加，顶部显示前后字节数。
- 支持常用图形、文字、渐变、裁剪、遮罩、图案、滤镜，以及指向本图内 `#id` 的引用。内联样式只支持静态 SVG 展示属性；复杂语法、`!important`、自定义属性和外部资源样式会报错。
- 脚本、事件属性、动画、`foreignObject`、外部资源、`style` 元素等不支持的内容会被移除，并在每份导出代码前列出。清理可能改变外观，请检查后使用；本工具不是通用的 HTML/XSS 清洗器。
- 只处理完整合法的 XML，不支持 DTD/实体定义。输入最多 256 KiB、5000 个节点、64 层嵌套；重复 ID、缺失引用和循环引用会停止处理。

## 平台与要求

- 支持：Windows、macOS

## 网络与数据

- 不联网，数据只保存在本机。

## 开发验证

修改转换逻辑时，除 `tests/index.test.mjs` 外还要运行浏览器与框架集成套件（Node 需满足 jsdom 27 的要求，例如 22.12 或更新）：

```sh
npm install --prefix extensions/svg-icon-studio/tests --ignore-scripts --package-lock=false
node --test extensions/svg-icon-studio/tests/browser-cases.mjs
```

测试依赖只用于验证，不属于插件运行时。
