/**
 * UUID 生成器核心算法
 * 支持 UUID v1 (基于时间戳与节点), v4 (完全随机), v7 (Unix时间戳排序)
 * 依赖标准 Web Crypto (globalThis.crypto.getRandomValues)
 */

export type UuidVersion = "v4" | "v1" | "v7";
export type UuidFormat = "standard" | "uppercase" | "no-dash" | "no-dash-upper" | "braces" | "urn";

export interface FormatOption {
  value: UuidFormat;
  label: string;
  example: string;
}

export interface VersionOption {
  value: UuidVersion;
  label: string;
  desc: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  { value: "standard", label: "标准格式 (小写)", example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
  { value: "uppercase", label: "大写格式", example: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" },
  { value: "no-dash", label: "无连字符 (小写)", example: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { value: "no-dash-upper", label: "无连字符 (大写)", example: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
  { value: "braces", label: "花括号格式", example: "{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}" },
  { value: "urn", label: "URN 格式", example: "urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
];

export const VERSION_OPTIONS: VersionOption[] = [
  { value: "v4", label: "UUID v4 (随机)", desc: "RFC 9562 伪随机数生成，最广泛通用" },
  { value: "v1", label: "UUID v1 (时间戳)", desc: "基于 100ns 纪元时间戳与随机节点" },
  { value: "v7", label: "UUID v7 (时间排序)", desc: "基于 Unix 毫秒时间戳，按序索引友好" },
];

const MAX_UUID_COUNT = 100;
const MAX_ATTEMPTS_PER_UUID = 10;

/** 生成安全的随机字节 */
export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("SECURE_RANDOM_UNAVAILABLE: globalThis.crypto.getRandomValues 不可用");
  }
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

/** 字节数组转十六进制字符串 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 生成 UUID v4 (随机) */
export function generateV4(): string {
  const bytes = randomBytes(16);
  // 设置版本 4 与变体 RFC 4122
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 生成 UUID v1 (基于时间戳与节点) */
export function generateV1(): string {
  // Gregorian 纪元偏移 (1582-10-15 至 1970-01-01 的 100ns 计数值)
  const GREGORIAN_OFFSET = 122192928000000000n;
  const unixMilliseconds = Date.now();
  if (!Number.isSafeInteger(unixMilliseconds)) {
    throw new Error("UUID_V1_TIMESTAMP_INVALID: 当前系统时间异常");
  }
  const randomFields = randomBytes(4);
  const timestamp =
    BigInt(unixMilliseconds) * 10000n +
    GREGORIAN_OFFSET +
    BigInt(((randomFields[0]! << 8) | randomFields[1]!) % 10000);

  if (timestamp < 0n || timestamp >= 1n << 60n) {
    throw new Error("UUID_V1_TIMESTAMP_OUT_OF_RANGE: 时间戳溢出");
  }

  const timeLow = Number(timestamp & 0xffffffffn);
  const timeMid = Number((timestamp >> 32n) & 0xffffn);
  const timeHi = Number((timestamp >> 48n) & 0x0fffn) | 0x1000;

  const clockSeq = (((randomFields[2]! << 8) | randomFields[3]!) & 0x3fff) | 0x8000;
  const node = randomBytes(6);
  // RFC 9562: 随机生成节点时设置组播标志位
  node[0] = node[0]! | 0x01;

  return [
    timeLow.toString(16).padStart(8, "0"),
    timeMid.toString(16).padStart(4, "0"),
    timeHi.toString(16).padStart(4, "0"),
    clockSeq.toString(16).padStart(4, "0"),
    bytesToHex(node),
  ].join("-");
}

/** 生成 UUID v7 (基于 Unix 毫秒时间戳，有序) */
export function generateV7(): string {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || BigInt(now) > 0xffffffffffffn) {
    throw new Error("UUID_V7_TIMESTAMP_OUT_OF_RANGE: 时间戳超出范围");
  }
  const bytes = randomBytes(16);

  // 前 48 位: Unix 毫秒时间戳
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  // 版本 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // 变体 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 格式化 UUID */
export function formatUuid(uuid: string, fmt: UuidFormat): string {
  const raw = uuid.toLowerCase();
  switch (fmt) {
    case "standard":
      return raw;
    case "uppercase":
      return raw.toUpperCase();
    case "no-dash":
      return raw.replace(/-/g, "");
    case "no-dash-upper":
      return raw.replace(/-/g, "").toUpperCase();
    case "braces":
      return `{${raw}}`;
    case "urn":
      return `urn:uuid:${raw}`;
    default:
      return raw;
  }
}

export interface GenerateOptions {
  version?: UuidVersion;
  format?: UuidFormat;
  count?: number;
}

/** 批量生成 UUID */
export function generateUuids(options: GenerateOptions = {}): string[] {
  const version: UuidVersion = options.version ?? "v4";
  const format: UuidFormat = options.format ?? "standard";
  const count = options.count ?? 1;

  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_UUID_COUNT) {
    throw new Error(`生成数量必须是 1 到 ${MAX_UUID_COUNT} 之间的整数`);
  }

  const generators: Record<UuidVersion, () => string> = {
    v4: generateV4,
    v1: generateV1,
    v7: generateV7,
  };

  const gen = generators[version];
  if (!gen) {
    throw new Error(`不支持的 UUID 版本: ${version}`);
  }

  const results: string[] = [];
  const uniqueSet = new Set<string>();
  const maxAttempts = count * MAX_ATTEMPTS_PER_UUID;
  let attempts = 0;

  while (results.length < count && attempts < maxAttempts) {
    attempts += 1;
    const rawUuid = gen();
    if (uniqueSet.has(rawUuid)) continue;
    uniqueSet.add(rawUuid);
    results.push(formatUuid(rawUuid, format));
  }

  if (results.length !== count) {
    throw new Error("UUID_BATCH_NOT_UNIQUE: 批量生成唯一性失败");
  }

  return results;
}
