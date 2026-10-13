/**
 * ZTools 万年历、农历、二十四节气与老黄历核心算法 (纯 TypeScript，零外部依赖)
 */

export interface LunarDateInfo {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
  monthName: string;
  dayName: string;
  fullText: string;
  zodiac: string;
  yearGanZhi: string;
  dayGanZhi: string;
}

export interface AlmanacInfo {
  officer: string;
  yi: string[];
  ji: string[];
  clash: string;
}

export type HolidayStatus = "holiday" | "workday";

export interface HolidayArrangement {
  name: string;
  status: HolidayStatus;
}

export interface CalendarInfo {
  date: Date;
  dateKey: string;
  dateZh: string;
  dayOfWeek: string;
  lunar: LunarDateInfo | null;
  solarTerm: string;
  festivals: string[];
  legalFestivals: string[];
  holiday: HolidayArrangement | null;
  almanac: AlmanacInfo | null;
}

export const WEEK_DAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

// 农历 1900 - 2100 年份压缩编码表
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0,
  0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
  0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50,
  0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
  0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
  0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573,
  0x052d0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
  0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5,
  0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46,
  0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
  0x055c0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50,
  0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
  0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
  0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0,
  0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
  0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370,
  0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0,
  0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50,
  0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930, 0x07337, 0x06aa0,
  0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968, 0x0d520,
  0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
];

const SOLAR_TERM_INFO = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551,
  218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447,
  419210, 440795, 462224, 483532, 504758
];

export const SOLAR_TERMS = [
  "小寒", "大寒", "立春", "雨水", "惊蛰", "春分",
  "清明", "谷雨", "立夏", "小满", "芒种", "夏至",
  "小暑", "大暑", "立秋", "处暑", "白露", "秋分",
  "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"
];

export const HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
export const EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
export const ZODIACS = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
export const LUNAR_MONTHS = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
export const LUNAR_DAYS = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
];

export const SOLAR_FESTIVALS: Record<string, string[]> = {
  "01-01": ["元旦"],
  "02-14": ["情人节"],
  "03-08": ["妇女节"],
  "03-12": ["植树节"],
  "04-01": ["愚人节"],
  "05-01": ["劳动节"],
  "05-04": ["青年节"],
  "06-01": ["儿童节"],
  "07-01": ["建党节"],
  "08-01": ["建军节"],
  "09-10": ["教师节"],
  "10-01": ["国庆节"],
  "10-24": ["程序员节"],
  "12-24": ["平安夜"],
  "12-25": ["圣诞节"]
};

export const LUNAR_FESTIVALS: Record<string, string[]> = {
  "01-01": ["春节"],
  "01-15": ["元宵节"],
  "02-02": ["龙抬头"],
  "05-05": ["端午节"],
  "07-07": ["七夕节"],
  "07-15": ["中元节"],
  "08-15": ["中秋节"],
  "09-09": ["重阳节"],
  "12-08": ["腊八节"],
  "12-23": ["北方小年"],
  "12-24": ["南方小年"]
};

export const LEGAL_HOLIDAY_NAMES = new Set([
  "元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节"
]);

const OFFICIAL_HOLIDAY_RANGES = [
  // 2025
  { name: "元旦", status: "holiday" as const, dates: ["2025-01-01"] },
  { name: "春节", status: "holiday" as const, start: "2025-01-28", end: "2025-02-04" },
  { name: "春节", status: "workday" as const, dates: ["2025-01-26", "2025-02-08"] },
  { name: "清明节", status: "holiday" as const, start: "2025-04-04", end: "2025-04-06" },
  { name: "劳动节", status: "holiday" as const, start: "2025-05-01", end: "2025-05-05" },
  { name: "劳动节", status: "workday" as const, dates: ["2025-04-27"] },
  { name: "端午节", status: "holiday" as const, start: "2025-05-31", end: "2025-06-02" },
  { name: "国庆中秋", status: "holiday" as const, start: "2025-10-01", end: "2025-10-08" },
  { name: "国庆中秋", status: "workday" as const, dates: ["2025-09-28", "2025-10-11"] },
  // 2026
  { name: "元旦", status: "holiday" as const, start: "2026-01-01", end: "2026-01-03" },
  { name: "元旦", status: "workday" as const, dates: ["2026-01-04"] },
  { name: "春节", status: "holiday" as const, start: "2026-02-15", end: "2026-02-23" },
  { name: "春节", status: "workday" as const, dates: ["2026-02-14", "2026-02-28"] },
  { name: "清明节", status: "holiday" as const, start: "2026-04-04", end: "2026-04-06" },
  { name: "劳动节", status: "holiday" as const, start: "2026-05-01", end: "2026-05-05" },
  { name: "劳动节", status: "workday" as const, dates: ["2026-05-09"] },
  { name: "端午节", status: "holiday" as const, start: "2026-06-19", end: "2026-06-21" },
  { name: "中秋节", status: "holiday" as const, start: "2026-09-25", end: "2026-09-27" },
  { name: "国庆节", status: "holiday" as const, start: "2026-10-01", end: "2026-10-07" },
  { name: "国庆节", status: "workday" as const, dates: ["2026-09-20", "2026-10-10"] }
];

export const TWELVE_OFFICERS = [
  { name: "建", yi: ["出行", "赴任", "祈福", "求嗣"], ji: ["动土", "开仓", "安葬"] },
  { name: "除", yi: ["扫舍", "沐浴", "解除", "求医"], ji: ["嫁娶", "远行", "开市"] },
  { name: "满", yi: ["祭祀", "交易", "纳财", "立券"], ji: ["安葬", "破土", "修造"] },
  { name: "平", yi: ["修整", "交易", "出行", "会友"], ji: ["祈福", "开光", "嫁娶"] },
  { name: "定", yi: ["订盟", "纳采", "安床", "入宅"], ji: ["诉讼", "出行", "动土"] },
  { name: "执", yi: ["捕捉", "签约", "纳财", "祭祀"], ji: ["搬迁", "嫁娶", "开市"] },
  { name: "破", yi: ["破屋", "坏垣", "求医", "解除"], ji: ["嫁娶", "开市", "入宅"] },
  { name: "危", yi: ["安床", "祭祀", "祈福", "求医"], ji: ["登高", "行船", "远行"] },
  { name: "成", yi: ["开市", "交易", "嫁娶", "入宅"], ji: ["诉讼", "安葬", "拆卸"] },
  { name: "收", yi: ["纳财", "捕捉", "收纳", "祭祀"], ji: ["开业", "安葬", "破土"] },
  { name: "开", yi: ["开市", "出行", "动土", "求财"], ji: ["安葬", "封闭", "词讼"] },
  { name: "闭", yi: ["祭祀", "修整", "安门", "静养"], ji: ["开市", "出行", "嫁娶"] }
];

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateZh(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = WEEK_DAYS[date.getDay()]!;
  return `${y}年${m}月${d}日 ${w}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

export function diffDays(a: Date, b: Date): number {
  const da = startOfDay(a).getTime();
  const db = startOfDay(b).getTime();
  return Math.round((da - db) / 86400000);
}

function buildOfficialHolidayMap(): Record<string, HolidayArrangement> {
  const map: Record<string, HolidayArrangement> = {};

  for (const item of OFFICIAL_HOLIDAY_RANGES) {
    const dates = [...(item.dates || [])];
    if (item.start && item.end) {
      const s = new Date(item.start + "T00:00:00");
      const e = new Date(item.end + "T00:00:00");
      const days = diffDays(e, s) + 1;
      for (let i = 0; i < days; i++) {
        dates.push(formatDateKey(addDays(s, i)));
      }
    }

    for (const d of dates) {
      map[d] = {
        name: item.name,
        status: item.status
      };
    }
  }

  return map;
}

const OFFICIAL_HOLIDAY_MAP = buildOfficialHolidayMap();

const LUNAR_START_DATE = new Date(1900, 0, 31); // 1900-01-31
const LUNAR_FIRST_YEAR = 1900;
const LUNAR_LAST_YEAR = 1900 + LUNAR_INFO.length - 1;

function leapMonth(year: number): number {
  return (LUNAR_INFO[year - 1900] ?? 0) & 0xf;
}

function leapDays(year: number): number {
  if (!leapMonth(year)) return 0;
  return (LUNAR_INFO[year - 1900] ?? 0) & 0x10000 ? 30 : 29;
}

function lunarMonthDays(year: number, month: number): number {
  return (LUNAR_INFO[year - 1900] ?? 0) & (0x10000 >> month) ? 30 : 29;
}

function lunarYearDays(year: number): number {
  let sum = 348;
  const info = LUNAR_INFO[year - 1900] ?? 0;
  for (let mask = 0x8000; mask > 0x8; mask >>= 1) {
    sum += info & mask ? 1 : 0;
  }
  return sum + leapDays(year);
}

export function isLunarDateSupported(date: Date): boolean {
  const y = date.getFullYear();
  if (y < LUNAR_FIRST_YEAR || y > LUNAR_LAST_YEAR) return false;
  return date.getTime() >= LUNAR_START_DATE.getTime();
}

function getGanZhi(index: number): string {
  return `${HEAVENLY_STEMS[index % 10] ?? ""}${EARTHLY_BRANCHES[index % 12] ?? ""}`;
}

export function getLunarDate(date: Date): LunarDateInfo {
  const target = startOfDay(date);
  if (!isLunarDateSupported(target)) {
    throw new RangeError("LUNAR_DATE_OUT_OF_RANGE");
  }

  let offset = diffDays(target, LUNAR_START_DATE);
  let year = LUNAR_FIRST_YEAR;
  let temp = 0;

  for (; year <= LUNAR_LAST_YEAR; year++) {
    temp = lunarYearDays(year);
    if (offset < temp) break;
    offset -= temp;
  }

  if (year > LUNAR_LAST_YEAR) {
    throw new RangeError("LUNAR_DATE_OUT_OF_RANGE");
  }

  const leap = leapMonth(year);
  let isLeapMonth = false;
  let month = 1;

  for (; month < 13 && offset > 0; month++) {
    if (leap > 0 && month === leap + 1 && !isLeapMonth) {
      month--;
      isLeapMonth = true;
      temp = leapDays(year);
    } else {
      temp = lunarMonthDays(year, month);
    }

    if (isLeapMonth && month === leap + 1) {
      isLeapMonth = false;
    }

    offset -= temp;
  }

  if (offset === 0 && leap > 0 && month === leap + 1) {
    if (isLeapMonth) {
      isLeapMonth = false;
    } else {
      isLeapMonth = true;
      month--;
    }
  }

  if (offset < 0) {
    offset += temp;
    month--;
  }

  const day = offset + 1;
  const monthName = `${isLeapMonth ? "闰" : ""}${LUNAR_MONTHS[month - 1] ?? month}月`;
  const dayName = LUNAR_DAYS[day - 1] ?? `${day}`;
  const dayIndex = diffDays(target, new Date(1900, 0, 1)) + 10;

  return {
    year,
    month,
    day,
    isLeapMonth,
    monthName,
    dayName,
    fullText: `${monthName}${dayName}`,
    zodiac: ZODIACS[(year - 4) % 12] ?? "",
    yearGanZhi: getGanZhi((year - 4 + 60) % 60),
    dayGanZhi: getGanZhi(((dayIndex % 60) + 60) % 60)
  };
}

function getSolarTermDay(year: number, index: number): number {
  const d = new Date(
    31556925974.7 * (year - 1900) +
      (SOLAR_TERM_INFO[index] ?? 0) * 60000 +
      Date.UTC(1900, 0, 6, 2, 5)
  );
  return d.getUTCDate();
}

export function getSolarTerm(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstIndex = month * 2;
  const day = date.getDate();

  if (day === getSolarTermDay(year, firstIndex)) {
    return SOLAR_TERMS[firstIndex] ?? "";
  }
  if (day === getSolarTermDay(year, firstIndex + 1)) {
    return SOLAR_TERMS[firstIndex + 1] ?? "";
  }
  return "";
}

export function getFestivals(date: Date, lunar: LunarDateInfo | null, solarTerm: string): string[] {
  const solarKey = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const lunarKey = lunar
    ? `${pad(lunar.month)}-${pad(lunar.day)}`
    : "";

  const festivals: string[] = [
    ...(SOLAR_FESTIVALS[solarKey] ?? []),
    ...(lunar && !lunar.isLeapMonth ? LUNAR_FESTIVALS[lunarKey] ?? [] : [])
  ];

  if (solarTerm === "清明") {
    festivals.push("清明节");
  }

  if (
    lunar &&
    !lunar.isLeapMonth &&
    lunar.month === 12 &&
    lunar.day === lunarMonthDays(lunar.year, 12)
  ) {
    festivals.push("除夕");
  }

  return [...new Set(festivals)];
}

export function getAlmanac(lunar: LunarDateInfo): AlmanacInfo {
  const dayBranch = EARTHLY_BRANCHES.indexOf(lunar.dayGanZhi.slice(1));
  const officerIndex = ((dayBranch - lunar.month + 12) % 12 + 12) % 12;
  const officer = TWELVE_OFFICERS[officerIndex] ?? {
    name: "平",
    yi: ["修整", "交易", "出行", "会友"],
    ji: ["祈福", "开光", "嫁娶"]
  };
  const clashBranch = EARTHLY_BRANCHES[(dayBranch + 6) % 12] ?? "";
  const clashZodiac = ZODIACS[(dayBranch + 6) % 12] ?? "";

  return {
    officer: `${officer.name}日`,
    yi: officer.yi,
    ji: officer.ji,
    clash: `冲${clashZodiac} (${clashBranch})`
  };
}

export function getCalendarInfo(date: Date): CalendarInfo {
  const target = startOfDay(date);
  const lunar = isLunarDateSupported(target) ? getLunarDate(target) : null;
  const solarTerm = getSolarTerm(target);
  const festivals = getFestivals(target, lunar, solarTerm);
  const dateKey = formatDateKey(target);
  const holiday = OFFICIAL_HOLIDAY_MAP[dateKey] ?? null;
  const legalFestivals =
    holiday?.status === "holiday"
      ? [holiday.name]
      : festivals.filter((item) => LEGAL_HOLIDAY_NAMES.has(item));

  return {
    date: target,
    dateKey,
    dateZh: formatDateZh(target),
    dayOfWeek: WEEK_DAYS[target.getDay()]!,
    lunar,
    solarTerm,
    festivals,
    legalFestivals,
    holiday,
    almanac: lunar ? getAlmanac(lunar) : null
  };
}

/**
 * 获取未来若干天内具有特殊标记（节日/节气/节假日）的日期列表
 */
export function getUpcomingSpecialDays(baseDate: Date = new Date(), daysAhead: number = 45): CalendarInfo[] {
  const list: CalendarInfo[] = [];
  const start = startOfDay(baseDate);

  for (let i = 0; i <= daysAhead; i++) {
    const current = addDays(start, i);
    const info = getCalendarInfo(current);
    if (info.festivals.length > 0 || info.solarTerm || info.holiday) {
      list.push(info);
    }
  }

  return list;
}

/**
 * 解析各种日期输入格式（如 "2026-10-01", "2026/10/01", "20261001", "10-01" 等）
 */
export function parseDateInput(input: string): Date | null {
  const text = input.trim();
  if (!text) return null;

  // YYYY-MM-DD 或 YYYY/MM/DD
  const m1 = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m1) {
    const y = parseInt(m1[1]!, 10);
    const m = parseInt(m1[2]!, 10) - 1;
    const d = parseInt(m1[3]!, 10);
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return date;
    }
  }

  // YYYYMMDD
  const m2 = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) {
    const y = parseInt(m2[1]!, 10);
    const m = parseInt(m2[2]!, 10) - 1;
    const d = parseInt(m2[3]!, 10);
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return date;
    }
  }

  return null;
}

/**
 * 搜索匹配的日历信息 (支持按节日名、节气名、公历日期、农历文字过滤)
 */
export function searchCalendarDates(query: string, baseDate: Date = new Date()): CalendarInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // 若输入直接为有效日期
  const parsed = parseDateInput(q);
  if (parsed) {
    return [getCalendarInfo(parsed)];
  }

  // 否则在当前年及临近年份搜索匹配的节日或节气
  const year = baseDate.getFullYear();
  const results: CalendarInfo[] = [];

  // 搜索当年整年 365 天中匹配的项
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);
  const totalDays = diffDays(endOfYear, startOfYear) + 1;

  for (let i = 0; i < totalDays; i++) {
    const d = addDays(startOfYear, i);
    const info = getCalendarInfo(d);

    const matchesFestival = info.festivals.some((f) => f.toLowerCase().includes(q));
    const matchesSolarTerm = info.solarTerm.toLowerCase().includes(q);
    const matchesHoliday = info.holiday?.name.toLowerCase().includes(q);
    const matchesLunar = info.lunar?.fullText.includes(q);
    const matchesDateKey = info.dateKey.includes(q);

    if (matchesFestival || matchesSolarTerm || matchesHoliday || matchesLunar || matchesDateKey) {
      results.push(info);
    }
  }

  return results;
}
