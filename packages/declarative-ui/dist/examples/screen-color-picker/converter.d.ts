export interface RGB {
    r: number;
    g: number;
    b: number;
    a?: number;
}
export interface HSL {
    h: number;
    s: number;
    l: number;
}
export interface HSV {
    h: number;
    s: number;
    v: number;
}
export interface CMYK {
    c: number;
    m: number;
    y: number;
    k: number;
}
export interface WcagRating {
    contrastOnWhite: number;
    contrastOnBlack: number;
    whiteRating: "AAA" | "AA" | "AA Large" | "Fail";
    blackRating: "AAA" | "AA" | "AA Large" | "Fail";
    recommendedText: "white" | "black";
}
export interface ColorHarmonies {
    complementary: string;
    analogous: [string, string];
    triadic: [string, string];
    splitComplementary: [string, string];
    tetradic: [string, string, string];
    monochromatic: string[];
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
export interface PickedColorResult {
    hex: string;
    rgb: RGB;
    hsl: HSL;
    hsv: HSV;
    x?: number;
    y?: number;
    source: "native" | "simulated";
    pickedAt: number;
}
/**
 * 规范化 Hex 字符串 (支持 3 位、4 位、6 位、8 位)
 */
export declare function normalizeHex(hex: string): string;
export declare function hexToRgb(hex: string): RGB;
export declare function rgbToHex(rgb: RGB): string;
export declare function rgbToHsl(rgb: RGB): HSL;
export declare function hslToRgb(hsl: HSL): RGB;
export declare function rgbToHsv(rgb: RGB): HSV;
export declare function hsvToRgb(hsv: HSV): RGB;
export declare function rgbToCmyk(rgb: RGB): CMYK;
export declare function cmykToRgb(cmyk: CMYK): RGB;
export declare function calculateContrast(rgb1: RGB, rgb2: RGB): number;
export declare function calculateWcag(rgb: RGB): WcagRating;
/**
 * 产生专业配色方案 (互补色、类似色、三色、分裂互补色、单色阶梯)
 */
export declare function generateHarmonies(rgb: RGB): ColorHarmonies;
/**
 * 智能色彩解析器 (支持 HEX, RGB, RGBA, HSL, HSLA, HSV, CMYK 以及常用命名色彩)
 */
export declare function parseColor(input: string): ColorConversionResult;
/**
 * 产生一个包含色块的 SVG Data URL 用于在虚拟 Detail Markdown 中渲染
 */
export declare function generateColorSwatchSvg(hex: string, width?: number, height?: number): string;
/**
 * 屏幕拾色器核心 (Screen Eyedropper)
 * 结合 screen_get_cursor_pos 与 ColorPickerPlugin.pickScreenPixel / screen_pick_color 获取真实屏幕像素 RGB/HEX 值；
 * 真实宿主下若失败则如实抛出错误，彻底清零随机伪造假颜色的代码。
 */
export declare function pickScreenColor(hostOverride?: any): Promise<PickedColorResult>;
/**
 * 调色板 LocalStorage 持久化操作
 */
export declare function getSavedPalette(): Promise<SavedColorItem[]>;
export declare function saveColorToPalette(name: string, hex: string): Promise<SavedColorItem[]>;
export declare function clearPalette(): Promise<void>;
export declare function removeFromPalette(id: string): Promise<SavedColorItem[]>;
/**
 * 拾色历史记录持久化操作
 */
export declare function getColorHistory(): Promise<PickedColorResult[]>;
export declare function saveColorHistory(item: PickedColorResult): Promise<PickedColorResult[]>;
export declare function clearColorHistory(): Promise<void>;
export declare const convertColor: typeof parseColor;
