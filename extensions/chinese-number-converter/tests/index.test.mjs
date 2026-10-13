import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/raycast-compat";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("chinese-number-converter 插件规范与端到端集成测试", () => {
  test("1. plugin.json 清单结构合规性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "chinese-number-converter");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "icon.svg 文件必须存在");
  });

  test("2. 中文数字与银行发票金额转换精度 (正向与反向闭环)", async () => {
    const {
      numberToChinese,
      numberToTicketUppercase,
      chineseToNumber,
      convertBatch,
      DEFAULT_TICKET_RULES
    } = await import("../dist/logic.js");

    // 基础数字转简体小写与繁体大写
    assert.equal(numberToChinese("12345.67", "lower"), "一万二千三百四十五点六七");
    assert.equal(numberToChinese("12345.67", "upper"), "壹万贰仟叁佰肆拾伍点陆柒");

    // 零与跨级处理 (亿、万、千)
    assert.equal(numberToChinese("100200300.5", "lower"), "一亿零二十万零三百点五");
    assert.equal(numberToChinese("100200300.5", "upper"), "壹亿零贰拾万零叁佰点伍");

    // 银行发票级人民币大写 (元角分整)
    assert.equal(
      numberToTicketUppercase("12345.67", DEFAULT_TICKET_RULES),
      "壹万贰仟叁佰肆拾伍元陆角柒分"
    );
    assert.equal(numberToTicketUppercase("500", DEFAULT_TICKET_RULES), "伍佰元整");
    assert.equal(numberToTicketUppercase("0.05", DEFAULT_TICKET_RULES), "零元零伍分");
    assert.equal(numberToTicketUppercase("10.05", DEFAULT_TICKET_RULES), "壹拾元零伍分");

    // 规则配置: 自定义前缀、圆、正
    const customRules = {
      ...DEFAULT_TICKET_RULES,
      currencyPrefix: "人民币",
      yuanUnit: "圆",
      wholeSuffix: "正"
    };
    assert.equal(numberToTicketUppercase("500", customRules), "人民币伍佰圆正");

    // 舍入模式验证: half-up vs truncate
    assert.equal(
      numberToTicketUppercase("10.555", { ...DEFAULT_TICKET_RULES, roundingMode: "half-up" }),
      "壹拾元伍角陆分"
    );
    assert.equal(
      numberToTicketUppercase("10.555", { ...DEFAULT_TICKET_RULES, roundingMode: "truncate" }),
      "壹拾元伍角伍分"
    );

    // 中文数字反向转阿拉伯数字
    assert.equal(chineseToNumber("壹万贰仟叁佰肆拾伍点陆柒"), "12345.67");
    assert.equal(chineseToNumber("一万二千三百四十五点六七"), "12345.67");
    assert.equal(chineseToNumber("壹万贰仟叁佰肆拾伍元陆角柒分"), "12345.67");
    assert.equal(chineseToNumber("伍佰元整"), "500");
    assert.equal(chineseToNumber("负五万零三"), "-50003");

    // 批量转换测试
    const batchText = "100\n200.5\n300.08";
    const batchRes = convertBatch(batchText, "to-ticket");
    assert.equal(batchRes.length, 3);
    assert.equal(batchRes[0].output, "壹佰元整");
    assert.equal(batchRes[1].output, "贰佰元伍角");
    assert.equal(batchRes[2].output, "叁佰元零捌分");
  });

  test("3. 异常分支与非法数据防御测试", async () => {
    const { numberToChinese, chineseToNumber, parseArabicDecimal } = await import("../dist/logic.js");

    // 异常 1: 空输入
    assert.throws(() => parseArabicDecimal(""), /请输入有效数字/);
    assert.throws(() => chineseToNumber(""), /请输入中文数字/);

    // 异常 2: 非法字符
    assert.throws(() => parseArabicDecimal("abc123"), /不是有效的十进制数字格式/);
    assert.throws(() => chineseToNumber("一百块钱"), /包含无法识别的中文数字字符/);

    // 异常 3: 千位分隔符错误
    assert.throws(() => parseArabicDecimal("1,23,456"), /千位分隔符位置不正确/);

    // 异常 4: 超过 16 位极值
    assert.throws(() => parseArabicDecimal("12345678901234567"), /整数部分最多支持 16 位数字/);
  });

  test("4. 声明式 UI 挂载与结构渲染", async () => {
    const { default: ChineseNumberConverterCommand } = await import("../dist/index.js");

    const root = renderDeclarativeRoot(ChineseNumberConverterCommand);
    const desc = root.getLatest();

    assert.ok(desc, "渲染视图描述符必须存在");
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "中文数字与金额转换");
    assert.ok(desc.children.length >= 2, "必须包含示例区和规则设置区");

    root.unmount();
  });
});
