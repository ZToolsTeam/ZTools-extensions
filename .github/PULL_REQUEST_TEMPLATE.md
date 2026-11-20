## Summary / 改动说明

<!-- What this PR does and why. For a new plugin, clearly explain the problem it solves. -->
<!-- 这个 PR 做了什么、为什么要做。新插件请写清楚它解决什么问题。 -->

## Affected Plugins / 涉及的插件

<!-- Plugin ID and version change, e.g., my-tool 1.0.0 -> 1.1.0, or "New plugin". Write "None" if only changing tooling. -->
<!-- 插件 ID 与版本变化，例如：my-tool 1.0.0 → 1.1.0；新插件写「新插件」。只改开发工具可写「无」。 -->

## Permissions / 权限说明

<!-- Explain where each declared permission is used; for network access, list target domains and purposes. Write "No change" if unchanged. -->
<!-- 每个声明的权限用在哪里；用了网络请写明请求的域名和用途。没有新增权限可写「无变化」。 -->

## Verification / 验证

Tested OS / 验证过的系统：<!-- e.g., Windows 11 x64 / macOS 15 Apple Silicon, matching targets -->

Checks run / 运行过的检查：

- [ ] `node scripts/build-declarative.mjs <id>`
- [ ] `node scripts/scan-plugin-security.mjs extensions/<id>`
- [ ] `node --test extensions/<id>/tests/*.test.mjs`
- [ ] `node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main`

Verified in the ZTools client / 在客户端里试用过：

- [ ] Normal flow / 正常操作
- [ ] Empty state / 空结果
- [ ] Error or missing-permission feedback / 出错或无权限时的提示

## Checklist / 检查清单

- [ ] `author` follows [Author Attribution](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/en/publishing.md#author-attribution) ([作者署名](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/publishing.md#作者署名)): use your GitHub handle or real team name for new community plugins; keep original attribution when updating existing plugins
- [ ] Passed all 6 items in the [UI Guidelines Pre-Submit Checklist](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/en/ui-guidelines.md#pre-submit-checklist) ([界面规范 · 提交前自检](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/ui-guidelines.md#提交前自检))
- [ ] Bumped `version` when modifying an existing plugin / 修改已有插件时升高了 `version`
- [ ] `targets` includes only platforms actually tested / `targets` 只包含实际测试过的平台
- [ ] No `dist/`, local paths, credentials, or personal data committed / 没有提交 `dist/`、本机路径、凭据或日志里的个人信息

<!-- Note: After the PR is merged, the official team publishes approved plugins to the plugin marketplace. / 说明：PR 合并后由官方发布到插件市场。 -->
