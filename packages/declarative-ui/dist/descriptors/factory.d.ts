import { ViewDescriptor } from "./types.js";
/**
 * 获取由函数式组件生成的 ViewDescriptor 关联的组件渲染工厂函数，
 * 以便在 Action.Push 或 navigation.push(<ChildComponent />) 时挂载独立响应式实例
 */
export declare function getComponentFactory(descriptor: unknown): (() => any) | undefined;
/**
 * 校验一个对象是否为有效的 ViewDescriptor
 */
export declare function isViewDescriptor(obj: unknown): obj is ViewDescriptor;
/**
 * 扁平化并清洗 children 节点
 */
export declare function normalizeChildren(children: any): ViewDescriptor[];
/**
 * 递归解析属性中的描述符或 ReactElement（如 props.actions, props.searchBarAccessory 等）
 */
export declare function resolveDescriptorValue(val: any): any;
/**
 * 创建 ViewDescriptor 虚拟视图描述符工厂函数
 */
export declare function createDescriptor<TProps = Record<string, any>>(type: string, rawProps?: TProps | null, ...explicitChildren: any[]): ViewDescriptor<TProps>;
/**
 * 兼容 React JSX/TSX 转换的 createElement 工厂
 */
export declare function createElement(type: any, props?: any, ...children: any[]): any;
/**
 * 兼容 React Fragment
 */
export declare function Fragment(props?: {
    children?: any;
}): any;
