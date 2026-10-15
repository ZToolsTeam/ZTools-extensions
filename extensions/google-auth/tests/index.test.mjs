import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDeclarativeRoot } from "@ztools/declarative-ui";
import {
  base32Decode,
  generateTOTP,
  formatToken,
  getRemainingSeconds,
  parseOTPAuthURL,
  createAccount,
  filterAccounts,
  cleanSecret,
  isValidBase32
} from "../dist/logic.js";
import GoogleAuthCommand, { CreateAccountForm } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

describe("google-auth 2FA 动态口令插件集成测试", () => {
  test("1. plugin.json 清单结构与资源完整性", () => {
    const manifestPath = path.join(pluginDir, "plugin.json");
    assert.ok(fs.existsSync(manifestPath), "plugin.json 必须存在");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, "google-auth");
    assert.equal(manifest.entry, "dist/index.js");
    assert.equal(manifest.icon, "icon.svg");
    assert.deepEqual(manifest.permissions, ["clipboard", "crypto"]);

    assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "icon.svg 必须存在");
    assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)), "dist/index.js 必须存在");
  });

  test("2. Base32 编码解码与异常输入防御", () => {
    // 正常解码
    const decoded = base32Decode("JBSWY3DPEHPK3PXP");
    assert.equal(decoded.toString("latin1"), "Hello!\xde\xad\xbe\xef");

    // 容错处理：空格、连字符、小写与末尾填充 =
    const decodedWithPadding = base32Decode("jbsw y3dp-ehpk 3pxp====");
    assert.equal(decodedWithPadding.toString("latin1"), "Hello!\xde\xad\xbe\xef");

    // 格式合法性校验辅助函数
    assert.equal(isValidBase32("JBSWY3DPEHPK3PXP"), true);
    assert.equal(isValidBase32("INVALID890"), false);
    assert.equal(isValidBase32(""), false);

    // 异常防御：空密钥抛出错误
    assert.throws(() => base32Decode(""), /密钥不能为空/);

    // 异常防御：非法字符（8, 9, 0, 特殊符号）抛出详细异常
    assert.throws(() => base32Decode("ABC8"), /包含非法字符 '8'/);
    assert.throws(() => base32Decode("ABC9"), /包含非法字符 '9'/);
    assert.throws(() => base32Decode("ABC0"), /包含非法字符 '0'/);
    assert.throws(() => base32Decode("ABC@#$"), /包含非法字符/);
  });

  test("3. RFC 6238 TOTP 国际标准已知测试向量验证", () => {
    // RFC 6238 官方已知向量：Secret 对应 '12345678901234567890' 的 Base32
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    // T = 59 秒 (T0 = 0, X = 30) -> Counter = 1
    const token59 = generateTOTP(rfcSecret, { nowMs: 59000, period: 30, digits: 6, algorithm: "SHA1" });
    assert.equal(token59, "287082", "RFC 6238 SHA1 @ 59s 应当为 287082");

    // T = 1111111109 秒 -> Counter = 37037036
    const token111 = generateTOTP(rfcSecret, { nowMs: 1111111109000, period: 30, digits: 6, algorithm: "SHA1" });
    assert.equal(token111, "081804", "RFC 6238 SHA1 @ 1111111109s 应当为 081804");

    // T = 1234567890 秒 -> Counter = 41152263 (RFC 6238 Table 1: 89005924)
    const token123 = generateTOTP(rfcSecret, { nowMs: 1234567890000, period: 30, digits: 6, algorithm: "SHA1" });
    assert.equal(token123, "005924", "RFC 6238 SHA1 @ 1234567890s 应当为 005924");

    // T = 2000000000 秒 -> Counter = 66666666
    const token200 = generateTOTP(rfcSecret, { nowMs: 2000000000000, period: 30, digits: 6, algorithm: "SHA1" });
    assert.equal(token200, "279037", "RFC 6238 SHA1 @ 2000000000s 应当为 279037");

    // 8 位口令生成与前置零填充补全
    const token8 = generateTOTP(rfcSecret, { nowMs: 59000, period: 30, digits: 8, algorithm: "SHA1" });
    assert.equal(token8.length, 8);
    assert.equal(token8, "94287082");

    // SHA256 与 SHA512 哈希算法支持
    const tokenSha256 = generateTOTP(rfcSecret, { nowMs: 59000, period: 30, digits: 6, algorithm: "SHA256" });
    assert.equal(tokenSha256.length, 6);
    assert.match(tokenSha256, /^\d{6}$/);

    const tokenSha512 = generateTOTP(rfcSecret, { nowMs: 59000, period: 30, digits: 6, algorithm: "SHA512" });
    assert.equal(tokenSha512.length, 6);
    assert.match(tokenSha512, /^\d{6}$/);

    // 口令格式化展示
    assert.equal(formatToken("287082"), "287 082");
    assert.equal(formatToken("94287082"), "9428 7082");

    // 倒计时剩余秒数计算
    const rem = getRemainingSeconds(30, 29000);
    assert.equal(rem, 1);
    const rem30 = getRemainingSeconds(30, 30000);
    assert.equal(rem30, 30);
  });

  test("4. otpauth:// URL 协议解析与异常拦截", () => {
    // 标准 Google Authenticator 链接
    const url1 = "otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30";
    const res1 = parseOTPAuthURL(url1);
    assert.equal(res1.type, "totp");
    assert.equal(res1.name, "octocat");
    assert.equal(res1.issuer, "GitHub");
    assert.equal(res1.secret, "JBSWY3DPEHPK3PXP");
    assert.equal(res1.digits, 6);
    assert.equal(res1.period, 30);
    assert.equal(res1.algorithm, "SHA1");

    // 自定义 8 位与 SHA256
    const url2 = "otpauth://totp/AWS:admin%40corp.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=AWS&algorithm=SHA256&digits=8&period=60";
    const res2 = parseOTPAuthURL(url2);
    assert.equal(res2.issuer, "AWS");
    assert.equal(res2.name, "admin@corp.com");
    assert.equal(res2.algorithm, "SHA256");
    assert.equal(res2.digits, 8);
    assert.equal(res2.period, 60);

    // 异常防御：非法协议头
    assert.throws(() => parseOTPAuthURL("https://example.com"), /必须以 otpauth:\/\/ 开头/);

    // 异常防御：缺少 secret 密钥
    assert.throws(() => parseOTPAuthURL("otpauth://totp/test?issuer=Test"), /缺少有效的 Base32 secret/);

    // 异常防御：secret 包含非法字符
    assert.throws(() => parseOTPAuthURL("otpauth://totp/test?secret=123INVALID89"), /缺少有效的 Base32 secret/);
  });

  test("5. 账号数据增删改查与检索过滤", () => {
    const acc = createAccount({
      name: "dev@ztools.org",
      issuer: "GitLab",
      secret: "JBSWY3DPEHPK3PXP",
      digits: 6,
      period: 30,
      algorithm: "SHA1"
    });
    assert.equal(acc.name, "dev@ztools.org");
    assert.equal(acc.issuer, "GitLab");
    assert.equal(acc.secret, "JBSWY3DPEHPK3PXP");

    // 异常拦截
    assert.throws(() => createAccount({ name: "", secret: "JBSWY3DPEHPK3PXP" }), /账号名称不能为空/);
    assert.throws(() => createAccount({ name: "test", secret: "" }), /密钥不能为空/);
    assert.throws(() => createAccount({ name: "test", secret: "ABC999" }), /不是合法的 Base32/);

    // 检索过滤
    const list = [acc];
    assert.equal(filterAccounts(list, "gitlab").length, 1);
    assert.equal(filterAccounts(list, "ztools").length, 1);
    assert.equal(filterAccounts(list, "nonexistent").length, 0);
  });

  test("6. 声明式 UI 挂载与列表渲染", () => {
    const root = renderDeclarativeRoot(GoogleAuthCommand);
    const desc = root.getLatest();

    assert.ok(desc);
    assert.equal(desc.type, "List");
    assert.equal(desc.props.navigationTitle, "2FA 动态口令验证器");
    assert.ok(desc.children.length > 0);

    root.unmount();
  });
});
