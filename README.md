# ZTools Extensions (插件生态大仓)

> 欢迎来到 **ZTools** 官方开源扩展生态大仓！在这里，你可以为 Windows & macOS 双端效率神器 ZTools 贡献你的奇思妙想。

---

## ⚡ 5 分钟贡献你的首款插件

写插件无需克隆庞大的客户端主程序，全流程只需 **3 步**：

### 1. 克隆本仓库

```bash
git clone https://github.com/codingmuse/ZTools-extensions.git
cd ZTools-extensions
```

### 2. 一行命令生成插件工程

```bash
# 格式: npm run create-plugin <plugin-id> [title] [description]
npm run create-plugin my-tool "我的效率工具" "基于声明式 UI 的日常好帮手"
```

脚手架将在 `extensions/my-tool/` 自动生成符合规范的标准工程。

### 3. 编写代码与本地实时预览

1. 打开电脑上安装好的 **ZTools 客户端**；
2. 进入「设置」->「开发者」面板，点击「加载本地开发插件」，选择刚才生成的 `extensions/my-tool` 目录；
3. 打开 VS Code 编写代码，保存后 ZTools 客户端将**毫秒级实时热重载**展示效果！

### 4. 提交 PR 审核上架

```bash
# 本地运行安全语法预检
npm test

# 提交代码并发起 PR
git checkout -b feat/my-tool
git add .
git commit -m "feat(extension): add my-tool plugin"
git push origin feat/my-tool
```

在 GitHub 上提交 PR 后，CI 自动化流水线将自动验证插件 AST 安全性。官方审核合并后，插件将自动发布至全网插件市场！

---

## 🎨 核心规范（纯声明式 UI 规范）

- **彻底封杀原生 DOM/CSS 自由发挥**：严禁直接操作 HTML DOM，严禁手写自定义 CSS；
- **纯语义化组件**：统一使用 `<List>`, `<Detail>`, `<Form>`, `<ActionPanel>`, `<Action>`，由宿主统一样式与主题呈现；
- **键盘优先**：方向键聚焦，`Enter` 执行主动作，`Ctrl+K` 打开动作面板。

---

## 📄 开源协议 (License)

本项目遵循宽松的 [MIT License](LICENSE)，充分尊重并保障生态贡献者的自由度与知识产权。
