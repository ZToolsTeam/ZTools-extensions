import { LocalStorage } from "@ztools/declarative-ui";

export interface RGB {
  r: number;
  g: number;
  b: number;
  a?: number; // 0..1
}

export interface HSL {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
}

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface WcagRating {
  contrastOnWhite: number; // e.g. 3.45:1
  contrastOnBlack: number; // e.g. 6.12:1
  whiteRating: "AAA" | "AA" | "AA Large" | "Fail";
  blackRating: "AAA" | "AA" | "AA Large" | "Fail";
  recommendedText: "white" | "black";
}

export interface ColorHarmonies {
  complementary: string; // +180°
  analogous: [string, string]; // -30°, +30°
  triadic: [string, string]; // +120°, +240°
  splitComplementary: [string, string]; // +150°, +210°
  tetradic: [string, string, string]; // +90°, +180°, +270°
  monochromatic: string[]; // 亮度阶梯渐变
}

export interface ColorConversionResult {
  hex: string;
  hex8: string;
  rgb: RGB;
  hsl: HSL;
  hsv: HSV;
  cmyk: CMYK;
  cssRgb: string;
  cssRgba: string;
  cssHsl: string;
  cssHsla: string;
  cssHsv: string;
  cssCmyk: string;
  cssVar: string;
  wcag: WcagRating;
  harmonies: ColorHarmonies;
  isValid: boolean;
}

export interface SavedColorItem {
  id: string;
  name: string;
  hex: string;
  savedAt: string;
}

const PALETTE_STORAGE_KEY = "color_picker_palette";

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  gray: "#808080",
  grey: "#808080",
  orange: "#FFA500",
  purple: "#800080",
  pink: "#FFC0CB",
  indigo: "#4B0082",
  gold: "#FFD700"
};

/**
 * 规范化 Hex 字符串 (支持 3 位、4 位、6 位、8 位)
 */
export function normalizeHex(hex: string): string {
  let clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  } else if (clean.length === 4) {
    clean = clean.split("").map((c) => c + c).join("");
  }

  if (clean.length === 8 && /^[0-9a-fA-F]{8}$/.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }

  if (!/^[0-9a-fA-F]{6}$/.test(clean.slice(0, 6))) {
    return "#000000";
  }
  return `#${clean.slice(0, 6).toUpperCase()}`;
}

export function hexToRgb(hex: string): RGB {
  const norm = normalizeHex(hex).slice(1);
  const r = parseInt(norm.substring(0, 2), 16) || 0;
  const g = parseInt(norm.substring(2, 4), 16) || 0;
  const b = parseInt(norm.substring(4, 6), 16) || 0;
  if (norm.length === 8) {
    const a = parseInt(norm.substring(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  return { r, g, b };
}

export function rgbToHex(rgb: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      let v = t;
      if (v < 0) v += 1;
      if (v > 1) v -= 1;
      if (v < 1 / 6) return p + (q - p) * 6 * v;
      if (v < 1 / 2) return q;
      if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100)
  };
}

export function hsvToRgb(hsv: HSV): RGB {
  const h = (hsv.h % 360) / 60;
  const s = hsv.s / 100;
  const v = hsv.v / 100;

  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 1) { r = c; g = x; b = 0; }
  else if (h >= 1 && h < 2) { r = x; g = c; b = 0; }
  else if (h >= 2 && h < 3) { r = 0; g = c; b = x; }
  else if (h >= 3 && h < 4) { r = 0; g = x; b = c; }
  else if (h >= 4 && h < 5) { r = x; g = 0; b = c; }
  else if (h >= 5 && h < 6) { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

export function rgbToCmyk(rgb: RGB): CMYK {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const k = 1 - Math.max(r, g, b);
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);

  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100)
  };
}

export function cmykToRgb(cmyk: CMYK): RGB {
  const c = cmyk.c / 100;
  const m = cmyk.m / 100;
  const y = cmyk.y / 100;
  const k = cmyk.k / 100;

  const r = Math.round(255 * (1 - c) * (1 - k));
  const g = Math.round(255 * (1 - m) * (1 - k));
  const b = Math.round(255 * (1 - y) * (1 - k));

  return { r, g, b };
}

// WCAG 2.1 对比度与相对亮度计算
function getLuminance(rgb: RGB): number {
  const sRgb = [rgb.r, rgb.g, rgb.b].map((val) => {
    const s = Math.max(0, Math.min(255, val)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRgb[0] + 0.7152 * sRgb[1] + 0.0722 * sRgb[2];
}

export function calculateContrast(rgb1: RGB, rgb2: RGB): number {
  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function evaluateRating(ratio: number): "AAA" | "AA" | "AA Large" | "Fail" {
  if (ratio >= 7.0) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3.0) return "AA Large";
  return "Fail";
}

export function calculateWcag(rgb: RGB): WcagRating {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  const contrastOnWhite = calculateContrast(rgb, white);
  const contrastOnBlack = calculateContrast(rgb, black);

  return {
    contrastOnWhite,
    contrastOnBlack,
    whiteRating: evaluateRating(contrastOnWhite),
    blackRating: evaluateRating(contrastOnBlack),
    recommendedText: contrastOnBlack >= contrastOnWhite ? "black" : "white"
  };
}

/**
 * 产生专业配色方案 (互补色、类似色、三色、分裂互补色、单色阶梯)
 */
export function generateHarmonies(rgb: RGB): ColorHarmonies {
  const hsl = rgbToHsl(rgb);
  const wrap = (deg: number) => (deg + 360) % 360;

  const toHexFromHue = (hue: number, s = hsl.s, l = hsl.l) =>
    rgbToHex(hslToRgb({ h: wrap(hue), s, l }));

  return {
    complementary: toHexFromHue(hsl.h + 180),
    analogous: [toHexFromHue(hsl.h - 30), toHexFromHue(hsl.h + 30)],
    triadic: [toHexFromHue(hsl.h + 120), toHexFromHue(hsl.h + 240)],
    splitComplementary: [toHexFromHue(hsl.h + 150), toHexFromHue(hsl.h + 210)],
    tetradic: [toHexFromHue(hsl.h + 90), toHexFromHue(hsl.h + 180), toHexFromHue(hsl.h + 270)],
    monochromatic: [
      toHexFromHue(hsl.h, hsl.s, Math.max(10, hsl.l - 25)),
      toHexFromHue(hsl.h, hsl.s, Math.max(15, hsl.l - 12)),
      toHexFromHue(hsl.h, hsl.s, Math.min(85, hsl.l + 12)),
      toHexFromHue(hsl.h, hsl.s, Math.min(95, hsl.l + 25))
    ]
  };
}

/**
 * 智能色彩解析器 (支持 HEX, RGB, RGBA, HSL, HSLA, HSV, CMYK 以及常用命名色彩)
 */
export function parseColor(input: string): ColorConversionResult {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // 0. 命名颜色支持
  if (NAMED_COLORS[lower]) {
    return parseColor(NAMED_COLORS[lower]);
  }

  // 1. HEX 匹配 (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    const hex = normalizeHex(trimmed);
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb);
    const hsv = rgbToHsv(rgb);
    const cmyk = rgbToCmyk(rgb);
    return {
      hex: hex.slice(0, 7),
      hex8: hex.length === 9 ? hex : `${hex}FF`,
      rgb,
      hsl,
      hsv,
      cmyk,
      cssRgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      cssRgba: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a ?? 1})`,
      cssHsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      cssHsla: `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${rgb.a ?? 1})`,
      cssHsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cssCmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cssVar: `--color-primary: ${hex.slice(0, 7)};`,
      wcag: calculateWcag(rgb),
      harmonies: generateHarmonies(rgb),
      isValid: true
    };
  }

  // 2. RGB 匹配 (rgb(r, g, b) 或 rgba(r, g, b, a))
  const rgbMatch = trimmed.match(/^rgba?\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbMatch) {
    const rgb: RGB = {
      r: Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10))),
      g: Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10))),
      b: Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10))),
      a: rgbMatch[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(rgbMatch[4]))) : 1
    };
    const hex = rgbToHex(rgb);
    const hsl = rgbToHsl(rgb);
    const hsv = rgbToHsv(rgb);
    const cmyk = rgbToCmyk(rgb);
    return {
      hex,
      hex8: `${hex}FF`,
      rgb,
      hsl,
      hsv,
      cmyk,
      cssRgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      cssRgba: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a ?? 1})`,
      cssHsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      cssHsla: `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${rgb.a ?? 1})`,
      cssHsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cssCmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cssVar: `--color-primary: ${hex};`,
      wcag: calculateWcag(rgb),
      harmonies: generateHarmonies(rgb),
      isValid: true
    };
  }

  // 3. HSL 匹配 (hsl(h, s%, l%) 或 hsla(h, s%, l%, a))
  const hslMatch = trimmed.match(/^hsla?\(\s*(-?\d+)\s*,\s*(-?\d+)%?\s*,\s*(-?\d+)%?(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (hslMatch) {
    const hsl: HSL = {
      h: ((parseInt(hslMatch[1], 10) % 360) + 360) % 360,
      s: Math.max(0, Math.min(100, parseInt(hslMatch[2], 10))),
      l: Math.max(0, Math.min(100, parseInt(hslMatch[3], 10)))
    };
    const rgb = hslToRgb(hsl);
    rgb.a = hslMatch[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(hslMatch[4]))) : 1;
    const hex = rgbToHex(rgb);
    const hsv = rgbToHsv(rgb);
    const cmyk = rgbToCmyk(rgb);
    return {
      hex,
      hex8: `${hex}FF`,
      rgb,
      hsl,
      hsv,
      cmyk,
      cssRgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      cssRgba: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a ?? 1})`,
      cssHsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      cssHsla: `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${rgb.a ?? 1})`,
      cssHsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cssCmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cssVar: `--color-primary: ${hex};`,
      wcag: calculateWcag(rgb),
      harmonies: generateHarmonies(rgb),
      isValid: true
    };
  }

  // 4. HSV 匹配 (hsv(h, s%, v%))
  const hsvMatch = trimmed.match(/^hsv\(?\s*(-?\d+)\s*,\s*(-?\d+)%?\s*,\s*(-?\d+)%?\)?/i);
  if (hsvMatch) {
    const hsv: HSV = {
      h: ((parseInt(hsvMatch[1], 10) % 360) + 360) % 360,
      s: Math.max(0, Math.min(100, parseInt(hsvMatch[2], 10))),
      v: Math.max(0, Math.min(100, parseInt(hsvMatch[3], 10)))
    };
    const rgb = hsvToRgb(hsv);
    const hex = rgbToHex(rgb);
    const hsl = rgbToHsl(rgb);
    const cmyk = rgbToCmyk(rgb);
    return {
      hex,
      hex8: `${hex}FF`,
      rgb,
      hsl,
      hsv,
      cmyk,
      cssRgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      cssRgba: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`,
      cssHsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      cssHsla: `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, 1)`,
      cssHsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cssCmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
      cssVar: `--color-primary: ${hex};`,
      wcag: calculateWcag(rgb),
      harmonies: generateHarmonies(rgb),
      isValid: true
    };
  }

  // 默认 Fallback
  const fallbackHex = "#0A84FF";
  const fallbackRgb = hexToRgb(fallbackHex);
  const fallbackHsl = rgbToHsl(fallbackRgb);
  const fallbackHsv = rgbToHsv(fallbackRgb);
  const fallbackCmyk = rgbToCmyk(fallbackRgb);
  return {
    hex: fallbackHex,
    hex8: `${fallbackHex}FF`,
    rgb: fallbackRgb,
    hsl: fallbackHsl,
    hsv: fallbackHsv,
    cmyk: fallbackCmyk,
    cssRgb: `rgb(${fallbackRgb.r}, ${fallbackRgb.g}, ${fallbackRgb.b})`,
    cssRgba: `rgba(${fallbackRgb.r}, ${fallbackRgb.g}, ${fallbackRgb.b}, 1)`,
    cssHsl: `hsl(${fallbackHsl.h}, ${fallbackHsl.s}%, ${fallbackHsl.l}%)`,
    cssHsla: `hsla(${fallbackHsl.h}, ${fallbackHsl.s}%, ${fallbackHsl.l}%, 1)`,
    cssHsv: `hsv(${fallbackHsv.h}, ${fallbackHsv.s}%, ${fallbackHsv.v}%)`,
    cssCmyk: `cmyk(${fallbackCmyk.c}%, ${fallbackCmyk.m}%, ${fallbackCmyk.y}%, ${fallbackCmyk.k}%)`,
    cssVar: `--color-primary: ${fallbackHex};`,
    wcag: calculateWcag(fallbackRgb),
    harmonies: generateHarmonies(fallbackRgb),
    isValid: false
  };
}

/**
 * 产生一个包含色块的 SVG Data URL 用于在虚拟 Detail Markdown 中渲染
 */
export function generateColorSwatchSvg(hex: string, width = 360, height = 120): string {
  const clean = normalizeHex(hex).slice(0, 7);
  const rgb = hexToRgb(clean);
  const wcag = calculateWcag(rgb);
  const textColor = wcag.recommendedText === "white" ? "#FFFFFF" : "#000000";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="12" fill="${clean}"/>
    <text x="${width / 2}" y="${height / 2 + 7}" fill="${textColor}" font-size="22" font-family="monospace" text-anchor="middle" font-weight="bold">${clean}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * sRGB → OKLCH（Björn Ottosson 的 OKLab 定义，CSS Color 4 同款）
 * 返回 CSS 写法，例如 oklch(62.8% 0.2577 29.23)
 */
export function rgbToOklch(rgb: RGB): { l: number; c: number; h: number; css: string } {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r), g = lin(rgb.g), b = lin(rgb.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  const lp = Math.round(L * 10000) / 100;
  const cr = Math.round(c * 10000) / 10000;
  // 无彩色（灰阶）时色相没有意义，按 CSS 规范写 none
  const hr = cr < 0.0002 ? "none" : String(Math.round(h * 100) / 100);
  return { l: lp, c: cr, h: cr < 0.0002 ? 0 : Math.round(h * 100) / 100, css: `oklch(${lp}% ${cr} ${hr})` };
}

/**
 * 调色板 LocalStorage 持久化操作
 */
function sanitizePalette(list: unknown): SavedColorItem[] {
  return Array.isArray(list)
    ? list.filter((c) => c && typeof c.id === "string" && typeof c.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(c.hex))
    : [];
}

/** 读取调色板；存储读失败时抛错（写入前必须用这个，避免读失败后把空列表覆盖回去） */
async function loadPaletteStrict(): Promise<SavedColorItem[]> {
  return sanitizePalette(await LocalStorage.getItem<SavedColorItem[]>(PALETTE_STORAGE_KEY));
}

export async function getSavedPalette(): Promise<SavedColorItem[]> {
  return loadPaletteStrict();
}

export async function saveColorToPalette(name: string, hex: string): Promise<SavedColorItem[]> {
  const current = await loadPaletteStrict();
  if (current.length >= 100) throw new Error("调色板最多保存 100 个颜色，请先删除一些");
  const newItem: SavedColorItem = {
    id: `color_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: name || hex,
    hex: normalizeHex(hex).slice(0, 7),
    savedAt: new Date().toLocaleString()
  };

  const updated = [newItem, ...current.filter((c) => c.hex !== newItem.hex)];
  await LocalStorage.setItem(PALETTE_STORAGE_KEY, updated);
  return updated;
}

export async function clearPalette(): Promise<void> {
  await LocalStorage.removeItem(PALETTE_STORAGE_KEY);
}

export async function removeFromPalette(id: string): Promise<SavedColorItem[]> {
  const current = await loadPaletteStrict();
  const updated = current.filter((c) => c.id !== id);
  await LocalStorage.setItem(PALETTE_STORAGE_KEY, updated);
  return updated;
}

export const convertColor = parseColor;

