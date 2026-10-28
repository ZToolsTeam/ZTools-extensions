# 图片 Base64

把图片文件或剪贴板里的图片转成 Base64，也能把 Base64、Data URL 或 SVG 源码还原成图片预览。

## 使用

- 命令：图片 Base64（关键词如 `base64`、`datauri`）。
- 打开后按 `Enter` 选择图片文件（PNG、JPEG、GIF、WebP、SVG，单张不超过 10 MB），按 `⌘/Ctrl+Enter` 读取剪贴板：依次尝试复制的图片文件、截图等剪贴板图片、文字。
- 也可以直接在输入框粘贴 Base64 字符串、`data:image/...;base64,` 链接或 SVG 源码，右侧显示图片预览、格式与大小；无法识别时提示原因。
- 结果提供 Data URL、纯 Base64、Markdown、HTML `<img>`、CSS 背景图五种写法：`Enter` 复制，`⌘/Ctrl+Enter` 保存为文本文件，`⌘/Ctrl+K` 打开动作面板。
- 结果超过 8 MiB 时不能复制，只能保存为文本文件；不提供把还原的图片另存为图片文件。

## 平台与要求

- 支持：Windows、macOS
- 客户端已内置，无需单独安装。

## 网络与数据

- 不联网，数据只保存在本机。
