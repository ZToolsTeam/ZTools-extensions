/**
 * 度量衡与物理单位换算核心算法
 * 支持长度、质量、面积、体积、速度、角度、数据大小、功/能/热、温度等 9 大分类
 * 支持公制、英美制、市制等多种计量体系实时换算与高精度处理
 */

export type UnitCategoryId =
  | "length"
  | "mass"
  | "area"
  | "volume"
  | "speed"
  | "angle"
  | "data"
  | "energy"
  | "temperature";

export type UnitSystemId = "metric" | "us" | "imperial" | "us-imperial" | "chinese" | "other";

export const unitSystemLabels: Record<UnitSystemId, string> = {
  metric: "公制",
  us: "美制",
  imperial: "英制",
  "us-imperial": "英美制",
  chinese: "市制",
  other: "其他",
};

export interface UnitDefinition {
  id: string;
  name: string;
  symbol: string;
  system?: UnitSystemId;
  factor?: number;
  toBase?: (value: number) => number;
  fromBase?: (value: number) => number;
}

export interface UnitCategory {
  id: UnitCategoryId;
  name: string;
  description: string;
  units: UnitDefinition[];
  defaultFrom: string;
  defaultTo: string;
}

export const unitCategories: UnitCategory[] = [
  {
    id: "length",
    name: "长度",
    description: "公制、英美通用与航海长度单位",
    defaultFrom: "meter",
    defaultTo: "kilometer",
    units: [
      { id: "millimeter", name: "毫米", symbol: "mm", system: "metric", factor: 0.001 },
      { id: "centimeter", name: "厘米", symbol: "cm", system: "metric", factor: 0.01 },
      { id: "meter", name: "米", symbol: "m", system: "metric", factor: 1 },
      { id: "kilometer", name: "千米", symbol: "km", system: "metric", factor: 1000 },
      { id: "inch", name: "英寸", symbol: "in", system: "us-imperial", factor: 0.0254 },
      { id: "foot", name: "英尺", symbol: "ft", system: "us-imperial", factor: 0.3048 },
      { id: "yard", name: "码", symbol: "yd", system: "us-imperial", factor: 0.9144 },
      { id: "mile", name: "英里", symbol: "mi", system: "us-imperial", factor: 1609.344 },
      { id: "nautical-mile", name: "海里", symbol: "nmi", system: "other", factor: 1852 },
    ],
  },
  {
    id: "mass",
    name: "质量",
    description: "公制、英美通用与市制质量单位",
    defaultFrom: "kilogram",
    defaultTo: "gram",
    units: [
      { id: "milligram", name: "毫克", symbol: "mg", system: "metric", factor: 0.000001 },
      { id: "gram", name: "克", symbol: "g", system: "metric", factor: 0.001 },
      { id: "kilogram", name: "千克", symbol: "kg", system: "metric", factor: 1 },
      { id: "tonne", name: "吨", symbol: "t", system: "metric", factor: 1000 },
      { id: "ounce", name: "盎司", symbol: "oz", system: "us-imperial", factor: 0.028349523125 },
      { id: "pound", name: "磅", symbol: "lb", system: "us-imperial", factor: 0.45359237 },
      { id: "jin", name: "斤", symbol: "斤", system: "chinese", factor: 0.5 },
      { id: "liang", name: "两", symbol: "两", system: "chinese", factor: 0.05 },
    ],
  },
  {
    id: "area",
    name: "面积",
    description: "公制、英美通用与土地面积单位",
    defaultFrom: "square-meter",
    defaultTo: "square-kilometer",
    units: [
      { id: "square-millimeter", name: "平方毫米", symbol: "mm²", system: "metric", factor: 0.000001 },
      { id: "square-centimeter", name: "平方厘米", symbol: "cm²", system: "metric", factor: 0.0001 },
      { id: "square-meter", name: "平方米", symbol: "m²", system: "metric", factor: 1 },
      { id: "square-kilometer", name: "平方千米", symbol: "km²", system: "metric", factor: 1000000 },
      { id: "hectare", name: "公顷", symbol: "ha", system: "metric", factor: 10000 },
      { id: "mu", name: "亩", symbol: "亩", system: "chinese", factor: 666.6666666666666 },
      { id: "square-inch", name: "平方英寸", symbol: "in²", system: "us-imperial", factor: 0.00064516 },
      { id: "square-foot", name: "平方英尺", symbol: "ft²", system: "us-imperial", factor: 0.09290304 },
      { id: "square-yard", name: "平方码", symbol: "yd²", system: "us-imperial", factor: 0.83612736 },
      { id: "square-mile", name: "平方英里", symbol: "mi²", system: "us-imperial", factor: 2589988.110336 },
      { id: "acre", name: "英亩", symbol: "ac", system: "us-imperial", factor: 4046.8564224 },
    ],
  },
  {
    id: "volume",
    name: "体积",
    description: "公制、美制与英制容量单位",
    defaultFrom: "liter",
    defaultTo: "milliliter",
    units: [
      { id: "milliliter", name: "毫升", symbol: "mL", system: "metric", factor: 0.001 },
      { id: "liter", name: "升", symbol: "L", system: "metric", factor: 1 },
      { id: "cubic-centimeter", name: "立方厘米", symbol: "cm³", system: "metric", factor: 0.001 },
      { id: "cubic-meter", name: "立方米", symbol: "m³", system: "metric", factor: 1000 },
      { id: "teaspoon", name: "茶匙 (美制)", symbol: "tsp", system: "us", factor: 0.00492892159375 },
      { id: "tablespoon", name: "汤匙 (美制)", symbol: "tbsp", system: "us", factor: 0.01478676478125 },
      { id: "fluid-ounce", name: "液体盎司 (美制)", symbol: "fl oz", system: "us", factor: 0.0295735295625 },
      { id: "cup", name: "杯 (美制)", symbol: "cup", system: "us", factor: 0.2365882365 },
      { id: "us-pint", name: "品脱 (美制)", symbol: "pt", system: "us", factor: 0.473176473 },
      { id: "us-quart", name: "夸脱 (美制)", symbol: "qt", system: "us", factor: 0.946352946 },
      { id: "gallon", name: "加仑 (美制)", symbol: "gal", system: "us", factor: 3.785411784 },
      { id: "imperial-gallon", name: "加仑 (英制)", symbol: "gal (英)", system: "imperial", factor: 4.54609 },
    ],
  },
  {
    id: "speed",
    name: "速度",
    description: "日常交通与航海速度单位",
    defaultFrom: "kilometer-per-hour",
    defaultTo: "meter-per-second",
    units: [
      { id: "meter-per-second", name: "米/秒", symbol: "m/s", factor: 1 },
      { id: "kilometer-per-hour", name: "千米/时", symbol: "km/h", factor: 1 / 3.6 },
      { id: "mile-per-hour", name: "英里/时", symbol: "mph", factor: 0.44704 },
      { id: "foot-per-second", name: "英尺/秒", symbol: "ft/s", factor: 0.3048 },
      { id: "knot", name: "节 (海里/时)", symbol: "kn", factor: 0.5144444444444445 },
      { id: "mach", name: "马赫 (标准大气)", symbol: "Mach", factor: 340.29 },
    ],
  },
  {
    id: "angle",
    name: "角度",
    description: "角度、弧度与圆周单位",
    defaultFrom: "degree",
    defaultTo: "radian",
    units: [
      { id: "degree", name: "度", symbol: "°", factor: Math.PI / 180 },
      { id: "circle", name: "整圆", symbol: "circle", factor: Math.PI * 2 },
      { id: "right-angle", name: "直角", symbol: "直角", factor: Math.PI / 2 },
      { id: "gradian", name: "百分度", symbol: "gon", factor: Math.PI / 200 },
      { id: "arcminute", name: "角分", symbol: "′", factor: Math.PI / 10800 },
      { id: "arcsecond", name: "角秒", symbol: "″", factor: Math.PI / 648000 },
      { id: "radian", name: "弧度", symbol: "rad", factor: 1 },
      { id: "milliradian", name: "毫弧度", symbol: "mrad", factor: 0.001 },
    ],
  },
  {
    id: "data",
    name: "数据存储",
    description: "十进制与二进制数据容量单位",
    defaultFrom: "megabyte",
    defaultTo: "mebibyte",
    units: [
      { id: "bit", name: "比特", symbol: "bit", factor: 0.125 },
      { id: "byte", name: "字节", symbol: "B", factor: 1 },
      { id: "kilobyte", name: "千字节 (十进制)", symbol: "KB", factor: 1000 },
      { id: "megabyte", name: "兆字节 (十进制)", symbol: "MB", factor: 1000000 },
      { id: "gigabyte", name: "吉字节 (十进制)", symbol: "GB", factor: 1000000000 },
      { id: "terabyte", name: "太字节 (十进制)", symbol: "TB", factor: 1000000000000 },
      { id: "kibibyte", name: "二进制千字节", symbol: "KiB", factor: 1024 },
      { id: "mebibyte", name: "二进制兆字节", symbol: "MiB", factor: 1048576 },
      { id: "gibibyte", name: "二进制吉字节", symbol: "GiB", factor: 1073741824 },
      { id: "tebibyte", name: "二进制太字节", symbol: "TiB", factor: 1099511627776 },
    ],
  },
  {
    id: "energy",
    name: "功与能量",
    description: "功、能量与热量常用单位",
    defaultFrom: "joule",
    defaultTo: "kilowatt-hour",
    units: [
      { id: "joule", name: "焦耳", symbol: "J", factor: 1 },
      { id: "kilojoule", name: "千焦", symbol: "kJ", factor: 1000 },
      { id: "megajoule", name: "兆焦", symbol: "MJ", factor: 1000000 },
      { id: "watt-hour", name: "瓦时", symbol: "W·h", factor: 3600 },
      { id: "kilowatt-hour", name: "千瓦时 (度)", symbol: "kW·h", factor: 3600000 },
      { id: "calorie", name: "卡路里", symbol: "cal", factor: 4.1868 },
      { id: "kilocalorie", name: "千卡 (大卡)", symbol: "kcal", factor: 4186.8 },
      { id: "british-thermal-unit", name: "英热单位", symbol: "BTU", factor: 1055.05585262 },
      { id: "foot-pound-force", name: "英尺磅", symbol: "ft·lbf", factor: 1.3558179483314 },
    ],
  },
  {
    id: "temperature",
    name: "温度",
    description: "摄氏、华氏及绝对温标",
    defaultFrom: "celsius",
    defaultTo: "fahrenheit",
    units: [
      {
        id: "celsius",
        name: "摄氏度",
        symbol: "°C",
        toBase: (value) => value,
        fromBase: (value) => value,
      },
      {
        id: "fahrenheit",
        name: "华氏度",
        symbol: "°F",
        toBase: (value) => (value - 32) * (5 / 9),
        fromBase: (value) => value * (9 / 5) + 32,
      },
      {
        id: "kelvin",
        name: "开尔文",
        symbol: "K",
        toBase: (value) => value - 273.15,
        fromBase: (value) => value + 273.15,
      },
      {
        id: "rankine",
        name: "兰氏度",
        symbol: "°R",
        toBase: (value) => (value - 491.67) * (5 / 9),
        fromBase: (value) => (value + 273.15) * (9 / 5),
      },
    ],
  },
];

export function getCategory(categoryId: UnitCategoryId): UnitCategory | undefined {
  return unitCategories.find((category) => category.id === categoryId);
}

const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 解析输入的数值字符串（支持常规小数与科学计数法） */
export function parseUnitInput(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized || !DECIMAL_NUMBER_PATTERN.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** 换算单个单位 */
export function convertUnit(
  value: number,
  categoryId: UnitCategoryId,
  fromUnitId: string,
  toUnitId: string
): number | null {
  if (!Number.isFinite(value)) return null;

  const category = getCategory(categoryId);
  const fromUnit = category?.units.find((unit) => unit.id === fromUnitId);
  const toUnit = category?.units.find((unit) => unit.id === toUnitId);
  if (!fromUnit || !toUnit) return null;

  if (!fromUnit.toBase && !toUnit.fromBase) {
    const fromFactor = fromUnit.factor ?? Number.NaN;
    const toFactor = toUnit.factor ?? Number.NaN;
    if (!Number.isFinite(fromFactor) || fromFactor <= 0 || !Number.isFinite(toFactor) || toFactor <= 0) {
      return null;
    }

    const ratio = fromFactor / toFactor;
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const result = value * ratio;
    if (!Number.isFinite(result) || (value !== 0 && result === 0)) return null;
    return result;
  }

  const baseValue = fromUnit.toBase
    ? fromUnit.toBase(value)
    : value * (fromUnit.factor ?? Number.NaN);
  if (!Number.isFinite(baseValue)) return null;

  const result = toUnit.fromBase
    ? toUnit.fromBase(baseValue)
    : baseValue / (toUnit.factor ?? Number.NaN);

  return Number.isFinite(result) ? result : null;
}

export function normalizePrecision(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.min(12, Math.max(0, Math.round(value)));
}

/** 格式化换算后的数值 */
export function formatConvertedValue(value: number | null, precision: number = 4): string {
  if (value === null || !Number.isFinite(value)) return "";
  const normalizedPrecision = normalizePrecision(precision);
  const rounded = Number(value.toFixed(normalizedPrecision));
  if (rounded === 0 && value !== 0 && normalizedPrecision > 0) {
    return String(Number(value.toExponential(normalizedPrecision)));
  }
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export interface UnitConversionResultItem {
  unit: UnitDefinition;
  value: number | null;
  formatted: string;
}

/** 将数值换算为该分类下的所有单位结果 */
export function convertToAllUnits(
  value: number,
  categoryId: UnitCategoryId,
  fromUnitId: string,
  precision: number = 4
): UnitConversionResultItem[] {
  const category = getCategory(categoryId);
  if (!category) return [];

  return category.units.map((unit) => {
    const converted = convertUnit(value, categoryId, fromUnitId, unit.id);
    return {
      unit,
      value: converted,
      formatted: formatConvertedValue(converted, precision),
    };
  });
}
