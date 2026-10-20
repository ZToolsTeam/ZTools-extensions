/**
 * ZTools 时间戳助手核心转换逻辑 (纯函数)
 */

export interface ParsedTimeResult {
  valid: boolean;
  error?: string;
  date?: Date;
  unixSeconds?: number;
  unixMilliseconds?: number;
  localDateTime?: string;
  beijingDateTime?: string;
  utcIso?: string;
  relativeTime?: string;
  dayOfWeek?: string;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function formatDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export function formatBeijingTime(d: Date): string {
  // UTC+8 偏移计算
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const beijingDate = new Date(utc + 3600000 * 8);
  return formatDateTime(beijingDate);
}

export function getRelativeTime(d: Date, now: Date = new Date()): string {
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const absSec = Math.abs(diffSec);
  const isFuture = diffSec > 0;

  if (absSec < 5) return "刚刚";
  if (absSec < 60) return isFuture ? `${absSec} 秒后` : `${absSec} 秒前`;
  const diffMin = Math.round(absSec / 60);
  if (diffMin < 60) return isFuture ? `${diffMin} 分钟后` : `${diffMin} 分钟前`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return isFuture ? `${diffHour} 小时后` : `${diffHour} 小时前`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return isFuture ? `${diffDay} 天后` : `${diffDay} 天前`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return isFuture ? `${diffMonth} 个月后` : `${diffMonth} 个月前`;
  const diffYear = Math.round(diffDay / 365);
  return isFuture ? `${diffYear} 年后` : `${diffYear} 年前`;
}

/**
 * 解析用户输入的时间戳或日期字符串
 */
export function parseTimeInput(rawInput?: string, referenceNow: Date = new Date()): ParsedTimeResult {
  const text = (rawInput || "").trim();

  // 空输入默认当前时间
  if (!text) {
    const d = referenceNow;
    return {
      valid: true,
      date: d,
      unixSeconds: Math.floor(d.getTime() / 1000),
      unixMilliseconds: d.getTime(),
      localDateTime: formatDateTime(d),
      beijingDateTime: formatBeijingTime(d),
      utcIso: d.toISOString(),
      relativeTime: "现在 (刚刚)",
      dayOfWeek: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()]
    };
  }

  let date: Date | null = null;

  // 1. 纯数字时间戳判断
  if (/^-?\d+$/.test(text)) {
    const num = Number(text);
    if (isNaN(num)) {
      return { valid: false, error: "时间戳数值超出安全表示范围" };
    }
    // 10 位数左右 (秒级)
    if (Math.abs(num) < 1e11) {
      date = new Date(num * 1000);
    } else {
      // 13 位数 (毫秒级)
      date = new Date(num);
    }
  } else {
    // 2. 常用的 年-月-日[ 时:分[:秒]] 写法按本地时间严格解析：不存在的日期（2 月 30 日、25 点）直接报错，不顺延
    const match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (match) {
      const [year, month, day, hour, min, sec] = [1, 2, 3, 4, 5, 6].map((i) => (match[i] ? parseInt(match[i], 10) : 0));
      const local = new Date(year, month - 1, day, hour, min, sec);
      const exact =
        local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === day &&
        local.getHours() === hour && local.getMinutes() === min && local.getSeconds() === sec;
      if (!exact) {
        return { valid: false, error: `「${text}」不是一个存在的日期或时间` };
      }
      date = local;
    } else {
      // 3. 其余写法（ISO 8601 带时区、RFC 2822 等）交给标准解析
      const parsed = Date.parse(text);
      if (!isNaN(parsed)) date = new Date(parsed);
    }
  }

  if (!date || isNaN(date.getTime())) {
    return {
      valid: false,
      error: `无法解析的时间内容: "${text}"，支持输入秒/毫秒时间戳或标准日期`
    };
  }

  // 边界保护：检查年份合理范围 (1970 ~ 2100)
  const fullYear = date.getFullYear();
  if (fullYear < 1970 || fullYear > 2200) {
    return {
      valid: false,
      error: `年份超出合理范围 (${fullYear})，请检查时间戳位数是否混淆`
    };
  }

  return {
    valid: true,
    date,
    unixSeconds: Math.floor(date.getTime() / 1000),
    unixMilliseconds: date.getTime(),
    localDateTime: formatDateTime(date),
    beijingDateTime: formatBeijingTime(date),
    utcIso: date.toISOString(),
    relativeTime: getRelativeTime(date, referenceNow),
    dayOfWeek: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]
  };
}
