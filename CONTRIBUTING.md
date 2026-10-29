# 贡献指南

欢迎通过 Issue 和 Pull Request 改进插件与开发工具。第一次写插件请先看 [开发入门](docs/getting-started.md)。

## 提交前检查清单

- [ ] 插件放在 `extensions/<id>/`，目录名与 `plugin.json` 的 `id` 一致，ID 不与已有插件重复。
- [ ] `author` 按[作者署名](docs/publishing.md#作者署名)填写：社区新插件推荐 GitHub 用户名，不加 `ZTools Community`；参与已有插件保留原署名。
- [ ] 提交了 `src/`、清单、图标和测试；没有提交 `dist/`、本机路径、凭据或构建缓存。
- [ ] 界面只用 `@ztools/declarative-ui` 组件，按 [界面规范](docs/ui-guidelines.md) 做完「提交前自检」6 条。
- [ ] 只声明用到的权限，并在 PR 里说明每个权限的用途（[权限说明](docs/api.md#权限)）。
- [ ] `targets` 只写实际测试过的平台，并在那些平台的 ZTools 客户端里试用过正常、空结果和出错三种情况（[试用方法](docs/getting-started.md#7-在-ztools-客户端里试用)）。
- [ ] 修改已有插件时升高了 `version`；没做完的标了 `draft`；要下架的写 `revoked` 而不是删目录（[发布规则](docs/publishing.md)）。
- [ ] 复制了 `extensions/shared/` 里的文件时，副本与原文件一致。
- [ ] 本地跑过下面的检查并全部通过。

审核人员会看什么见 [审核标准](docs/review.md)。

## 本地检查

开发中针对单个插件：

```bash
node scripts/build-declarative.mjs <id>
node scripts/scan-plugin-security.mjs extensions/<id>
node --test extensions/<id>/tests/*.test.mjs
```

提交到自己的分支后，运行和 CI 相同的合并前检查：

```bash
# 把官方 main 拉到本地 refs/remotes/upstream/main（Fork 仓库也可以用）
git fetch https://github.com/ZToolsTeam/ZTools-extensions.git main:refs/remotes/upstream/main
node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main
node --test packages/ztools-plugins-spec/tests/*.test.mjs
```

`verify-changed-plugins.mjs` 只看已提交的改动，先提交、保持工作区干净再运行，详见 [发布规则 · 合并前检查](docs/publishing.md#合并前检查)。

## 提交 Pull Request

按 PR 模板填写：改了什么、涉及哪些插件、在哪些系统上验证过、运行了哪些检查、为什么需要这些权限。维护者审核通过后合并，PR 合并后由官方发布到插件市场。

改的是开发工具（`scripts/`、`packages/`）时，CI 会重新检查全部插件，请在 PR 里说明影响范围。客户端本身的问题请到 [ZTools 仓库](https://github.com/ZToolsTeam/ZTools) 提交。
