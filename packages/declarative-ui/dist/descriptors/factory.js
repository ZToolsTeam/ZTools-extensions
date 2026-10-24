import { VIEW_DESCRIPTOR_SYMBOL } from "./types.js";
import { currentInstance, setCurrentInstance, setEvaluatingChildElement } from "../runtime/context.js";
const descriptorComponentFactories = new WeakMap();
/**
 * 获取由函数式组件生成的 ViewDescriptor 关联的组件渲染工厂函数，
 * 以便在 Action.Push 或 navigation.push(<ChildComponent />) 时挂载独立响应式实例
 */
export function getComponentFactory(descriptor) {
    if (typeof descriptor === "function") {
        return descriptor;
    }
    if (descriptor && typeof descriptor === "object") {
        return descriptorComponentFactories.get(descriptor);
    }
    return undefined;
}
/**
 * 校验一个对象是否为有效的 ViewDescriptor
 */
export function isViewDescriptor(obj) {
    return typeof obj === "object" && obj !== null && obj.$$typeof === VIEW_DESCRIPTOR_SYMBOL;
}
/**
 * 扁平化并清洗 children 节点
 */
export function normalizeChildren(children) {
    const result = [];
    function walk(item) {
        if (item === null || item === undefined || typeof item === "boolean") {
            return;
        }
        if (Array.isArray(item)) {
            for (const sub of item) {
                walk(sub);
            }
            return;
        }
        if (isViewDescriptor(item)) {
            result.push(item);
        }
        else if (typeof item === "object" && typeof item.type === "function") {
            // 如果传递的是 React 风格的元素 { type: Component, props: ... }
            try {
                const rendered = item.type(item.props || {});
                walk(rendered);
            }
            catch {
                // ignore
            }
        }
    }
    walk(children);
    return result;
}
/**
 * 递归解析属性中的描述符或 ReactElement（如 props.actions, props.searchBarAccessory 等）
 */
export function resolveDescriptorValue(val) {
    if (val === null || val === undefined || typeof val !== "object") {
        return val;
    }
    if (isViewDescriptor(val)) {
        return val;
    }
    if (Array.isArray(val)) {
        return val.map(resolveDescriptorValue);
    }
    // 如果是 React Element 风格的对象 { type: Component, props: ... }
    if (typeof val.type === "function") {
        try {
            const rendered = val.type(val.props || {});
            return resolveDescriptorValue(rendered);
        }
        catch {
            return val;
        }
    }
    // 普通纯对象，递归深拷贝并规范化内部可能挂载的描述符
    if (val.constructor === Object) {
        const res = {};
        for (const [k, v] of Object.entries(val)) {
            if (k === "children")
                continue;
            res[k] = resolveDescriptorValue(v);
        }
        return res;
    }
    return val;
}
/**
 * 创建 ViewDescriptor 虚拟视图描述符工厂函数
 */
export function createDescriptor(type, rawProps, ...explicitChildren) {
    const propsCopy = { ...(rawProps || {}) };
    const key = propsCopy.key;
    delete propsCopy.key;
    // children 可以来自 props.children，也可以来自剩余参数
    const incomingChildren = explicitChildren.length > 0 ? explicitChildren : propsCopy.children;
    delete propsCopy.children;
    const children = normalizeChildren(incomingChildren);
    // 递归解析并规范化 props 内部可能挂载的描述符/组件元素
    const resolvedProps = {};
    for (const [k, v] of Object.entries(propsCopy)) {
        resolvedProps[k] = resolveDescriptorValue(v);
    }
    return Object.freeze({
        $$typeof: VIEW_DESCRIPTOR_SYMBOL,
        type,
        props: Object.freeze(resolvedProps),
        children: Object.freeze(children),
        key: key !== undefined ? String(key) : undefined
    });
}
/**
 * 兼容 React JSX/TSX 转换的 createElement 工厂
 */
export function createElement(type, props, ...children) {
    if (typeof type === "function") {
        const combinedProps = { ...(props || {}) };
        if (children.length > 0) {
            combinedProps.children = children.length === 1 ? children[0] : children;
        }
        // 当父组件已经执行完顶层 Hooks 进入 JSX return 树求值阶段（hookIndex > 0）时，
        // 暂停 currentInstance 并标记 isEvaluatingChildElement，防止 .map() 内的子组件污染父组件的 Hooks 数组
        const shouldIsolateChild = currentInstance !== null && currentInstance.hookIndex > 0;
        const prevInstance = shouldIsolateChild ? setCurrentInstance(null) : currentInstance;
        const prevChildFlag = shouldIsolateChild ? setEvaluatingChildElement(true) : false;
        try {
            const rendered = type(combinedProps, ...children);
            if (rendered && typeof rendered === "object") {
                descriptorComponentFactories.set(rendered, () => type(combinedProps, ...children));
            }
            return rendered;
        }
        finally {
            if (shouldIsolateChild) {
                setCurrentInstance(prevInstance);
                setEvaluatingChildElement(prevChildFlag);
            }
        }
    }
    return createDescriptor(String(type), props, ...children);
}
/**
 * 兼容 React Fragment
 */
export function Fragment(props) {
    return normalizeChildren(props?.children);
}
