import crypto from "node:crypto";

export type OTPAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface AuthAccount {
  id: string;
  name: string;
  issuer: string;
  secret: string;
  period: number;
  digits: number;
  algorithm: OTPAlgorithm;
  createdAt: number;
}

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * 清理 Base32 密钥字符串
 */
export function cleanSecret(secret: string): string {
  return (secret || "")
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/=+$/, "");
}

/**
 * 校验 Base32 密钥合法性
 */
export function isValidBase32(secret: string): boolean {
  const cleaned = cleanSecret(secret);
  if (!cleaned || cleaned.length === 0) return false;
  for (let i = 0; i < cleaned.length; i++) {
    if (BASE32_CHARS.indexOf(cleaned[i]) === -1) {
      return false;
    }
  }
  return true;
}

/**
 * 解码 RFC 4648 Base32 字符串为 Buffer
 */
export function base32Decode(secret: string): Buffer {
  const cleaned = cleanSecret(secret);
  if (!cleaned) {
    throw new Error("密钥不能为空");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const val = BASE32_CHARS.indexOf(char);
    if (val === -1) {
      throw new Error(`密钥格式错误: 包含非法字符 '${char}'，Base32 仅允许 A-Z 和 2-7`);
    }

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * 根据 RFC 6238 标准生成 TOTP 动态口令
 */
export function generateTOTP(
  secret: string,
  options: {
    nowMs?: number;
    period?: number;
    digits?: number;
    algorithm?: OTPAlgorithm;
  } = {}
): string {
  const period = options.period && options.period > 0 ? options.period : 30;
  const digits = options.digits && options.digits >= 4 && options.digits <= 10 ? options.digits : 6;
  const algorithm = options.algorithm || "SHA1";
  const nowMs = options.nowMs !== undefined ? options.nowMs : Date.now();

  const keyBuffer = base32Decode(secret);
  const counter = Math.floor(nowMs / 1000 / period);

  // 构造 8 字节大端序计数器
  const counterBuffer = Buffer.alloc(8);
  let tempCounter = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = Number(tempCounter & 0xffn);
    tempCounter >>= 8n;
  }

  // 计算 HMAC
  const algoName = algorithm.toLowerCase();
  const hmac = crypto.createHmac(algoName, keyBuffer).update(counterBuffer).digest();

  // 动态截断 Dynamic Truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  const token = (binary % mod).toString().padStart(digits, "0");
  return token;
}

/**
 * 格式化口令显示（加空格便于肉眼识别）
 */
export function formatToken(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  return code;
}

/**
 * 计算剩余倒计时秒数
 */
export function getRemainingSeconds(period = 30, nowMs = Date.now()): number {
  const currentSec = Math.floor(nowMs / 1000);
  const remaining = period - (currentSec % period);
  return remaining === 0 ? period : remaining;
}

export interface ParsedOTPAuth {
  type: "totp" | "hotp";
  secret: string;
  name: string;
  issuer: string;
  period: number;
  digits: number;
  algorithm: OTPAlgorithm;
}

/**
 * 解析 otpauth:// 协议 URL
 */
export function parseOTPAuthURL(urlText: string): ParsedOTPAuth {
  const trimmed = (urlText || "").trim();
  if (!trimmed.toLowerCase().startsWith("otpauth://")) {
    throw new Error("链接必须以 otpauth:// 开头");
  }

  try {
    const parsedUrl = new URL(trimmed);
    const type = parsedUrl.hostname.toLowerCase();
    if (type !== "totp" && type !== "hotp") {
      throw new Error(`不支持的 OTP 类型: ${type}`);
    }

    const pathname = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
    let issuer = parsedUrl.searchParams.get("issuer") || "";
    let name = pathname;

    if (pathname.includes(":")) {
      const parts = pathname.split(":");
      if (!issuer) {
        issuer = parts[0].trim();
      }
      name = parts.slice(1).join(":").trim();
    }

    const secret = cleanSecret(parsedUrl.searchParams.get("secret") || "");
    if (!secret || !isValidBase32(secret)) {
      throw new Error("链接中缺少有效的 Base32 secret 密钥参数");
    }

    const digits = parseInt(parsedUrl.searchParams.get("digits") || "6", 10) || 6;
    const period = parseInt(parsedUrl.searchParams.get("period") || "30", 10) || 30;
    const rawAlgo = (parsedUrl.searchParams.get("algorithm") || "SHA1").toUpperCase();
    const algorithm: OTPAlgorithm = rawAlgo === "SHA256" || rawAlgo === "SHA512" ? rawAlgo : "SHA1";

    return {
      type: type as "totp" | "hotp",
      secret,
      name: name || issuer || "未命名账号",
      issuer: issuer || "2FA",
      period,
      digits,
      algorithm
    };
  } catch (err: any) {
    throw new Error(`解析 otpauth 链接失败: ${err.message}`);
  }
}

/**
 * 创建新账号
 */
export function createAccount(params: {
  name: string;
  secret: string;
  issuer?: string;
  period?: number;
  digits?: number;
  algorithm?: OTPAlgorithm;
}): AuthAccount {
  const trimmedName = (params.name || "").trim();
  if (!trimmedName) {
    throw new Error("账号名称不能为空");
  }

  const cleaned = cleanSecret(params.secret);
  if (!cleaned) {
    throw new Error("密钥不能为空");
  }

  if (!isValidBase32(cleaned)) {
    throw new Error("密钥不是合法的 Base32 编码（仅支持 A-Z 与 2-7）");
  }

  return {
    id: "auth_" + Math.random().toString(36).slice(2, 10),
    name: trimmedName,
    issuer: (params.issuer || "").trim() || "2FA",
    secret: cleaned,
    period: params.period && params.period > 0 ? params.period : 30,
    digits: params.digits && params.digits >= 4 && params.digits <= 10 ? params.digits : 6,
    algorithm: params.algorithm || "SHA1",
    createdAt: Date.now()
  };
}

/**
 * 账号列表过滤与检索
 */
export function filterAccounts(accounts: AuthAccount[], query: string): AuthAccount[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return accounts;
  return accounts.filter((item) => {
    return item.name.toLowerCase().includes(q) || item.issuer.toLowerCase().includes(q);
  });
}

/**
 * 预设样例账号列表
 */
export const DEFAULT_ACCOUNTS: AuthAccount[] = [
  {
    id: "auth-github-demo",
    name: "octocat@github.com",
    issuer: "GitHub",
    secret: "JBSWY3DPEHPK3PXP",
    period: 30,
    digits: 6,
    algorithm: "SHA1",
    createdAt: 1700000000000
  },
  {
    id: "auth-google-demo",
    name: "admin@ztools.org",
    issuer: "Google Workspace",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    period: 30,
    digits: 6,
    algorithm: "SHA1",
    createdAt: 1700000010000
  }
];
