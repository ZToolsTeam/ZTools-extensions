/// <reference types="node" />
import crypto from "node:crypto";

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha512";
export type CipherMode = "cbc" | "ecb";

export interface MultiHashResult {
  md5: string;
  md5Upper: string;
  md5_16: string;
  md5_16Upper: string;
  sha1: string;
  sha256: string;
  sha512: string;
  base64: string;
  urlEncoded: string;
}

export interface AesResult {
  success: boolean;
  result?: string;
  iv?: string;
  error?: string;
}

/**
 * 实时计算所有常用哈希与编码对比
 */
export function calculateMultiHash(text: string): MultiHashResult {
  const content = text ?? "";
  const md5 = crypto.createHash("md5").update(content, "utf8").digest("hex");
  const sha1 = crypto.createHash("sha1").update(content, "utf8").digest("hex");
  const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  const sha512 = crypto.createHash("sha512").update(content, "utf8").digest("hex");
  const base64 = Buffer.from(content, "utf8").toString("base64");
  const urlEncoded = encodeURIComponent(content);

  return {
    md5,
    md5Upper: md5.toUpperCase(),
    md5_16: md5.substring(8, 24),
    md5_16Upper: md5.substring(8, 24).toUpperCase(),
    sha1,
    sha256,
    sha512,
    base64,
    urlEncoded
  };
}

/**
 * Base64 编解码
 */
export function encodeBase64(text: string): string {
  return Buffer.from(text ?? "", "utf8").toString("base64");
}

export function decodeBase64(base64Str: string): { success: boolean; result?: string; error?: string } {
  try {
    const clean = (base64Str ?? "").trim().replace(/[ \t\r\n]/g, "");
    if (!clean) return { success: true, result: "" };
    if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
      return { success: false, error: "Base64 字符串格式非法或填充位数不正确" };
    }
    const buf = Buffer.from(clean, "base64");
    return { success: true, result: buf.toString("utf8") };
  } catch (err: any) {
    return { success: false, error: err?.message || "Base64 解码失败" };
  }
}

/**
 * 派生 256 位 (32 字节) 密钥与 128 位 (16 字节) IV
 */
function deriveKeyAndIv(key: string, ivStr?: string): { keyBuf: Buffer; ivBuf: Buffer } {
  // 使用 SHA-256 将任意长度密码归一化为标准的 32 字节 AES-256 密钥
  const keyBuf = crypto.createHash("sha256").update(key || "ztools-default-key").digest();

  // 若传入指定 IV，取其 MD5 的 16 字节；若未传入，取 keyBuf 的前 16 字节
  let ivBuf: Buffer;
  if (ivStr) {
    ivBuf = crypto.createHash("md5").update(ivStr).digest();
  } else {
    ivBuf = keyBuf.subarray(0, 16);
  }
  return { keyBuf, ivBuf };
}

/**
 * AES-256 对称加密
 */
export function aesEncrypt(
  plaintext: string,
  key: string,
  options: { mode?: CipherMode; iv?: string } = {}
): AesResult {
  try {
    const text = plaintext ?? "";
    const mode = options.mode || "cbc";
    const { keyBuf, ivBuf } = deriveKeyAndIv(key, options.iv);

    const cipherAlgorithm = mode === "cbc" ? "aes-256-cbc" : "aes-256-ecb";
    const cipher = mode === "cbc"
      ? crypto.createCipheriv(cipherAlgorithm, keyBuf, ivBuf)
      : crypto.createCipheriv(cipherAlgorithm, keyBuf, null);

    let encrypted = cipher.update(text, "utf8", "base64");
    encrypted += cipher.final("base64");

    return {
      success: true,
      result: encrypted,
      iv: mode === "cbc" ? ivBuf.toString("hex") : undefined
    };
  } catch (err: any) {
    return {
      success: false,
      error: `AES 加密失败: ${err?.message || "参数错误"}`
    };
  }
}

/**
 * AES-256 对称解密
 */
export function aesDecrypt(
  ciphertextBase64: string,
  key: string,
  options: { mode?: CipherMode; iv?: string } = {}
): AesResult {
  try {
    const rawCipher = (ciphertextBase64 ?? "").trim();
    if (!rawCipher) {
      return { success: false, error: "密文不能为空" };
    }

    const mode = options.mode || "cbc";
    const { keyBuf, ivBuf } = deriveKeyAndIv(key, options.iv);

    const cipherAlgorithm = mode === "cbc" ? "aes-256-cbc" : "aes-256-ecb";
    const decipher = mode === "cbc"
      ? crypto.createDecipheriv(cipherAlgorithm, keyBuf, ivBuf)
      : crypto.createDecipheriv(cipherAlgorithm, keyBuf, null);

    let decrypted = decipher.update(rawCipher, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return {
      success: true,
      result: decrypted
    };
  } catch (err: any) {
    return {
      success: false,
      error: `AES 解密失败: ${err?.message || "密钥错误或密文被篡改"}`
    };
  }
}

/**
 * 计算 HMAC 哈希
 */
export function calculateHmac(
  algorithm: HashAlgorithm,
  text: string,
  key: string
): string {
  return crypto.createHmac(algorithm, key || "").update(text ?? "", "utf8").digest("hex");
}
