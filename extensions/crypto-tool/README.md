# 编码与加密

文本的散列计算、Base64 / URL / Unicode / Hex 编解码、AES 加解密、HMAC 计算与 UUID 批量生成。

## 使用

- 命令：Base64 编解码、URL 编解码、MD5 / SHA 散列、AES 加解密、HMAC 计算、Unicode 编解码、Hex 编解码、UUID v4 批量生成；关键词如 `md5`、`base64解码`、`url编码`、`aes`、`hmac`、`uuid`。
- 散列模式下输入文字，实时列出 MD5（32 位大小写、16 位）、SHA-1、SHA-256、SHA-512、Base64 与 URL 编码；搜索框旁的下拉框可切换为 Base64 编解码、URL / Unicode / Hex 编解码。
- `Enter` 复制选中结果，`⌘/Ctrl+K` 打开动作面板进入 AES 加解密、HMAC 计算（SHA-256 / SHA-512 / SHA-1 / MD5）和 UUID 批量生成；表单里 `⌘/Ctrl+Enter` 执行加密 / 解密或复制 HMAC。
- AES 使用 AES-256-CBC：密钥取口令的 SHA-256；IV 填写时取其 MD5，留空时取密钥前 16 字节（同一口令和明文每次得到相同密文）；密文为 Base64。CBC 模式不校验密文完整性；与其他工具互通时需按相同方式处理口令和 IV。
- Base64 模式同时给出编码结果与解码结果；解码支持标准与 URL-safe 写法，结果须是 UTF-8 文本；Hex 按 UTF-8 编解码；格式不对时显示错误原因。
- UUID 一次生成 1 到 1000 个，使用系统安全随机数。

## 平台与要求

- 支持：Windows、macOS
- 客户端已内置，无需单独安装。

## 网络与数据

- 不联网，数据只保存在本机。
