import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";
import { generateQrSvg } from "../dist/qr-generator.js";
import QrCodeCommand, { QrDetailView, CreateQrForm } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("qr-code 官方标杆插件集成测试与异常用例套件", () => {
  test("1. plugin.json 清单结构合规性与必要资源文件完整性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "qr-code");
    assert.equal(manifest.name, "二维码生成器");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. generateQrSvg: 基础生成、不同纠错等级与尺寸定制", () => {
    const text = "https://ztools.dev";

    // 默认选项
    const rDefault = generateQrSvg(text);
    assert.ok(rDefault.svg);
    assert.ok(rDefault.dataUrl);
    assert.ok(rDefault.dataUrl.startsWith("data:image/svg+xml;utf8,"));
    assert.ok(rDefault.matrixSize >= 21);
    assert.ok(rDefault.svg.includes("<svg"));
    assert.ok(rDefault.svg.includes("viewBox=\"0 0 256 256\""));

    // 四级纠错等级测试 (L, M, Q, H)
    const levels = ["L", "M", "Q", "H"];
    for (const lvl of levels) {
      const rLevel = generateQrSvg(text, { errorCorrectionLevel: lvl });
      assert.ok(rLevel.svg);
      assert.ok(rLevel.matrixSize > 0);
    }

    // 自定义尺寸与边距
    const rCustom = generateQrSvg(text, { size: 512, margin: 2 });
    assert.ok(rCustom.svg.includes("viewBox=\"0 0 512 512\""));
  });

  test("3. generateQrSvg: 边界与极端输入 (空文本、超长文本、特殊字符、中文与 Emoji)", () => {
    // 空文本
    const rEmpty = generateQrSvg("");
    assert.ok(rEmpty.svg);
    assert.ok(rEmpty.dataUrl);
    assert.equal(rEmpty.matrixSize, 21);

    // 超长文本 (自增至更高版本 Version 5)
    const longText = "ZTools ".repeat(30); // ~210 字符
    const rLong = generateQrSvg(longText);
    assert.ok(rLong.svg);
    assert.ok(rLong.matrixSize > 30);

    // 中文与特殊符号
    const rChinese = generateQrSvg("你好世界！ZTools 极客效率中枢 🚀 ~!@#$%^&*()");
    assert.ok(rChinese.svg);
    assert.ok(rChinese.dataUrl);
  });

  test("4. 声明式 UI 挂载与全组件生命周期 (QrCodeCommand, QrDetailView, CreateQrForm)", () => {
    // 1. 主列表命令
    const listRoot = renderDeclarativeRoot(QrCodeCommand);
    const listDesc = listRoot.getLatest();
    assert.ok(listDesc);
    assert.equal(listDesc.type, "List");
    assert.equal(listDesc.props.navigationTitle, "二维码生成器");
    assert.ok(listDesc.children.length >= 1);
    const section = listDesc.children[0];
    assert.equal(section.type, "List.Section");
    assert.ok(section.children.length >= 2);
    listRoot.unmount();

    // 2. 详情视图
    const item = {
      id: "qr-test",
      title: "测试二维码",
      content: "https://ztools.dev",
      level: "M",
      createdAt: "12:00:00"
    };
    const detailView = QrDetailView({ item });
    assert.equal(detailView.type, "Detail");
    assert.equal(detailView.props.navigationTitle, "测试二维码");
    assert.ok(detailView.props.markdown.includes("data:image/svg+xml;utf8"));
    assert.equal(detailView.props.metadata.type, "Detail.Metadata");
    assert.equal(detailView.props.actions.type, "ActionPanel");

    // 3. 新建表单视图
    let created = null;
    const formRoot = renderDeclarativeRoot(() =>
      CreateQrForm({ onCreated: (it) => { created = it; } })
    );
    const formDesc = formRoot.getLatest();
    assert.equal(formDesc.type, "Form");
    assert.equal(formDesc.props.navigationTitle, "新建二维码");
    assert.ok(formDesc.children.length >= 3);
    formRoot.unmount();
  });
});
