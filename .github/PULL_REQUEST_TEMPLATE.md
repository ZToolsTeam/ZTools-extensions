## 改动说明

<!-- 这个 PR 做了什么、为什么要做。新插件请写清楚它解决什么问题。 -->

## 涉及的插件

<!-- 插件 ID 与版本变化，例如：my-tool 1.0.0 → 1.1.0；新插件写「新插件」。只改开发工具可写「无」。 -->

## 权限说明

<!-- 每个声明的权限用在哪里；用了网络请写明请求的域名和用途。没有新增权限可写「无变化」。 -->

## 验证

验证过的系统：<!-- 例如 Windows 11 x64 / macOS 15 Apple Silicon，与 targets 一致 -->

运行过的检查：

- [ ] `node scripts/build-declarative.mjs <id>`
- [ ] `node scripts/scan-plugin-security.mjs extensions/<id>`
- [ ] `node --test extensions/<id>/tests/*.test.mjs`
- [ ] `node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main`

在客户端里试用过：

- [ ] 正常操作
- [ ] 空结果
- [ ] 出错或无权限时的提示

## 检查清单

- [ ] 按[作者署名](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/publishing.md#作者署名)填写 `author`；社区新插件署名本人或实际团队，参与已有插件保留原署名
- [ ] 按 [界面规范](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/ui-guidelines.md#提交前自检) 做完「提交前自检」6 条
- [ ] 修改已有插件时升高了 `version`
- [ ] `targets` 只包含实际测试过的平台
- [ ] 没有提交 `dist/`、本机路径、凭据或日志里的个人信息
