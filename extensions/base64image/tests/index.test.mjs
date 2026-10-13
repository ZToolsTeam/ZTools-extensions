import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";
import {
  parseBase64Image,
  encodeSvgOrTextToBase64,
  formatFileSize,
  detectImageFormat,
  SAMPLE_PNG_DATA_URI,
  SAMPLE_SVG,
  MAXIMUM_BASE64_BYTES
} from "../dist/logic.js";
import Base64ImageCommand from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("base64image 插件端到端集成测试与健壮性验证", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "base64image");
    assert.equal(manifest.name, "Base64 图片编解码助手");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)));
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)));
  });

  test("2. 标准 PNG Data URI 解码与元数据提取", () => {
    const res = parseBase64Image(SAMPLE_PNG_DATA_URI);
    assert.equal(res.valid, true);
    assert.equal(res.format, "png");
    assert.equal(res.mimeType, "image/png");
    assert.ok(res.byteLength > 0);
    assert.ok(res.dataUri.startsWith("data:image/png;base64,"));
    assert.ok(res.markdown.startsWith("![image](data:image/png;base64,"));
    assert.ok(res.html.includes('<img src="data:image/png;base64,'));
    assert.ok(res.cssBackground.includes("background-image: url('data:image/png;base64,"));
  });

  test("3. 纯 Base64 (无 Data URI 前缀) 解析", () => {
    const rawBase64 = SAMPLE_PNG_DATA_URI.replace(/^data:image\/png;base64,/, "");
    const res = parseBase64Image(rawBase64);
    assert.equal(res.valid, true);
    assert.equal(res.format, "png");
    assert.equal(res.mimeType, "image/png");
  });

  test("4. 多图片格式魔数检测 (PNG, JPG, GIF, WebP, SVG)", () => {
    // PNG signature
    assert.equal(
      detectImageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
      "png"
    );

    // JPG signature
    assert.equal(
      detectImageFormat(new Uint8Array([255, 216, 255, 224, 0, 16])),
      "jpg"
    );

    // GIF signature
    const gifBytes = new Uint8Array([71, 73, 70, 56, 57, 97]); // GIF89a
    assert.equal(detectImageFormat(gifBytes), "gif");

    // WebP signature
    const webpBytes = new Uint8Array([
      82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80
    ]); // RIFF....WEBP
    assert.equal(detectImageFormat(webpBytes), "webp");

    // SVG
    const svgBytes = new TextEncoder().encode(SAMPLE_SVG);
    assert.equal(detectImageFormat(svgBytes), "svg");
  });

  test("5. SVG 源码及普通文本转 Base64 编码", () => {
    // SVG 编码
    const svgRes = encodeSvgOrTextToBase64(SAMPLE_SVG);
    assert.equal(svgRes.valid, true);
    assert.equal(svgRes.format, "svg");
    assert.equal(svgRes.mimeType, "image/svg+xml");
    assert.ok(svgRes.dataUri.startsWith("data:image/svg+xml;base64,"));
    assert.ok(svgRes.markdown.startsWith("![svg]("));

    // 普通文本编码
    const textRes = encodeSvgOrTextToBase64("Hello ZTools 2026");
    assert.equal(textRes.valid, true);
    assert.equal(textRes.mimeType, "text/plain");
    assert.ok(textRes.dataUri.startsWith("data:text/plain;base64,"));
  });

  test("6. 边界与破坏性异常测试", () => {
    // 空输入
    const emptyRes = parseBase64Image("");
    assert.equal(emptyRes.valid, false);
    assert.ok(emptyRes.error);

    const emptyEncode = encodeSvgOrTextToBase64("");
    assert.equal(emptyEncode.valid, false);
    assert.ok(emptyEncode.error);

    // 非 ASCII 字符注入 Base64
    const nonAscii = parseBase64Image("data:image/png;base64,中文非法字符");
    assert.equal(nonAscii.valid, false);
    assert.ok(nonAscii.error);

    // 非法 Base64 编码 (字符或填充错误)
    const malformedBase64 = parseBase64Image("%%%===notbase64");
    assert.equal(malformedBase64.valid, false);
    assert.ok(malformedBase64.error);

    // 未知/不支持的二进制数据
    const randomBytesBase64 = "dGVzdC1yYW5kb20tZGF0YS1ub3QtaW1hZ2U="; // "test-random-data-not-image"
    const unknownRes = parseBase64Image(randomBytesBase64);
    assert.equal(unknownRes.valid, false);
    assert.ok(unknownRes.error.includes("仅支持"));

    // 超限测试 (超长保护)
    const hugeFake = "a".repeat(MAXIMUM_BASE64_BYTES + 10);
    const hugeRes = parseBase64Image(hugeFake);
    assert.equal(hugeRes.valid, false);
    assert.ok(hugeRes.error.includes("16MiB"));

    // 格式化文件体积测试
    assert.equal(formatFileSize(500), "500 B");
    assert.equal(formatFileSize(2048), "2.0 KB");
    assert.equal(formatFileSize(1048576 * 2.5), "2.50 MB");
  });

  test("7. 声明式 UI 挂载与动态状态流转", () => {
    const root = renderDeclarativeRoot(Base64ImageCommand);
    const desc = root.getLatest();

    assert.ok(desc, "必须生成根视图描述符");
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "Base64 图片编解码助手");
    assert.ok(desc.children.length > 0);

    // 检查根 actions 包含示例加载操作
    assert.ok(desc.props.actions);
    assert.equal(desc.props.actions.type, "ActionPanel");

    root.unmount();
  });
});
