import { getDeclarativeBridge } from "./bridge.js";
/**
 * 打开外部链接或应用
 */
export async function open(target) {
    const bridge = getDeclarativeBridge();
    if (typeof bridge?.openUrl === "function") {
        await bridge.openUrl(target);
        return;
    }
    if (typeof bridge?.openExternal === "function") {
        await bridge.openExternal(target);
        return;
    }
    const globalScope = globalThis;
    if (typeof globalScope.window !== "undefined") {
        const win = globalScope.window;
        if (typeof win.ztools?.shell?.openExternal === "function") {
            await win.ztools.shell.openExternal(target);
            return;
        }
        if (typeof win.open === "function") {
            win.open(target, "_blank");
            return;
        }
    }
    // Node fallback
    console.log(`[RaycastCompat] open called with: ${target}`);
}
