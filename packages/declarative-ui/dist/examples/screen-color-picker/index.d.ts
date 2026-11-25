import { convertColor, ColorConversionResult } from "./converter.js";
export * from "./converter.js";
export { convertColor };
/**
 * 颜色可视化与全能合规详情视图
 */
export declare function ColorDetailView({ color }: {
    color: ColorConversionResult;
}): JSX.Element;
/**
 * 调色板与屏幕取色主命令 (布局三：左 34% 参数工作台 + 右 66% 调色板与拾色队列)
 */
export declare function ColorPickerCommand(): JSX.Element;
export default ColorPickerCommand;
